<?php

namespace App\Console\Commands;

use App\Actions\Notes\ApplyNoteChange;
use App\Models\Attachment;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Http\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Normalizer;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use ZipArchive;

class ImportNotePlan extends Command
{
    protected $signature = 'donote:import-noteplan
        {zip : Path to a zip of the NotePlan data folder (containing Notes/ and Calendar/)}
        {--user= : Email of the workspace owner to import into}
        {--include-trash : Also import notes from @Trash}
        {--dry-run : Report what would happen without writing}';

    protected $description = 'Import a NotePlan export: notes, calendar notes, and attachments';

    /** @var array<string, string> extension => mime for attachment uploads */
    private const MIMES = [
        'txt' => 'text/plain', 'md' => 'text/markdown', 'html' => 'text/html',
        'csv' => 'text/csv', 'json' => 'application/json', 'pdf' => 'application/pdf',
        'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'heic' => 'image/heic',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    private const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

    public function handle(ApplyNoteChange $apply): int
    {
        $zipPath = (string) $this->argument('zip');
        $email = strtolower((string) $this->option('user'));
        $dryRun = (bool) $this->option('dry-run');

        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if ($user === null) {
            $this->error("No user with email {$email} — pass --user=you@example.com");

            return self::FAILURE;
        }

        $team = $user->currentTeam ?? $user->personalTeam();

        if ($team === null) {
            $this->error('That user has no team.');

            return self::FAILURE;
        }

        if (! is_file($zipPath)) {
            $this->error("Zip not found: {$zipPath}");

            return self::FAILURE;
        }

        $workDir = storage_path('app/noteplan-import-'.Str::random(8));
        $zip = new ZipArchive;

        if ($zip->open($zipPath) !== true || ! $zip->extractTo($workDir)) {
            $this->error('Could not open or extract the zip.');

            return self::FAILURE;
        }

        $zip->close();

        try {
            $base = $this->locateBase($workDir);

            if ($base === null) {
                $this->error('The zip does not contain a Notes/ or Calendar/ folder.');

                return self::FAILURE;
            }

            $stats = $this->import($apply, $team, $user, $base, $dryRun);

            $this->info(($dryRun ? '[DRY RUN] ' : '')."Imported into {$team->name} as {$user->email}:");
            $this->table(
                ['Notes', 'Skipped (already exist)', 'Calendar notes', 'Merged', 'Attachments', 'Unresolved refs', 'Empty files'],
                [[$stats['notes'], $stats['skipped'], $stats['calendar'], $stats['merged'], $stats['attachments'], $stats['unresolved'], $stats['empty']]],
            );

            return self::SUCCESS;
        } finally {
            \Illuminate\Support\Facades\File::deleteDirectory($workDir);
        }
    }

    /** The zip may nest the data folder one level deep — find it. */
    private function locateBase(string $workDir): ?string
    {
        foreach ([$workDir, ...glob($workDir.'/*', GLOB_ONLYDIR) ?: []] as $candidate) {
            if (is_dir($candidate.'/Notes') || is_dir($candidate.'/Calendar')) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * @return array<string, int>
     */
    private function import(ApplyNoteChange $apply, Team $team, User $user, string $base, bool $dryRun): array
    {
        $stats = ['notes' => 0, 'skipped' => 0, 'calendar' => 0, 'merged' => 0, 'attachments' => 0, 'unresolved' => 0, 'empty' => 0];
        $attachmentIndex = $this->indexAttachmentFiles($base);
        $uploadedUrls = [];

        $existing = Note::query()->forWorkspace($team, $user)
            ->where('type', 'note')
            ->get(['folder', 'title'])
            ->map(fn (Note $note) => $note->folder.'/'.mb_strtolower($note->title))
            ->flip();

        foreach ($this->noteFiles($base) as [$path, $relative]) {
            $raw = file_get_contents($path);

            if ($raw === false || trim($raw) === '') {
                $stats['empty']++;

                continue;
            }

            $folder = str_replace('@', '', dirname($relative));
            $folder = $folder === '.' ? '' : $folder;
            $fallback = preg_replace('/\.(md|txt)$/', '', basename($relative)) ?? basename($relative);
            [$title, $body] = $this->extractTitle($this->convertSyntax($raw), $fallback);

            if ($existing->has($folder.'/'.mb_strtolower($title))) {
                $stats['skipped']++;

                continue;
            }

            $body = $this->rewriteAttachmentRefs($body, $attachmentIndex, $uploadedUrls, $team, $user, $stats, $dryRun);
            $stats['notes']++;

            if (! $dryRun) {
                $apply->execute($team, $user, [
                    'id' => (string) Str::uuid(),
                    'type' => 'note',
                    'date_key' => null,
                    'title' => $title,
                    'content' => rtrim($body)."\n",
                    'folder' => $folder,
                    'pinned' => 0,
                    'deleted' => false,
                    'base_version' => 0,
                    'client_updated_at' => CarbonImmutable::createFromTimestamp(filemtime($path) ?: time())->toIso8601String(),
                ]);
            }
        }

        foreach (glob($base.'/Calendar/*.{md,txt}', GLOB_BRACE) ?: [] as $path) {
            $dateKey = $this->calendarKey(pathinfo($path, PATHINFO_FILENAME));

            if ($dateKey === null) {
                continue;
            }

            $raw = file_get_contents($path);

            if ($raw === false || trim($raw) === '') {
                $stats['empty']++;

                continue;
            }

            [$type, $key] = $dateKey;
            $content = $this->rewriteAttachmentRefs(
                rtrim($this->convertSyntax($raw))."\n",
                $attachmentIndex,
                $uploadedUrls,
                $team,
                $user,
                $stats,
                $dryRun,
            );

            $current = Note::query()->forWorkspace($team, $user)
                ->where('type', $type)->where('date_key', $key)->first();

            if ($current !== null && trim($current->content) !== '') {
                $content = rtrim($current->content)."\n\n".$content;
                $stats['merged']++;
            }

            $stats['calendar']++;

            if (! $dryRun) {
                $apply->execute($team, $user, [
                    'id' => $current !== null ? $current->id : (string) Str::uuid(),
                    'type' => $type,
                    'date_key' => $key,
                    'title' => '',
                    'content' => $content,
                    'folder' => '',
                    'pinned' => $current !== null ? $current->pinned : 0,
                    'deleted' => false,
                    'base_version' => $current !== null ? $current->version : 0,
                    'client_updated_at' => CarbonImmutable::createFromTimestamp(filemtime($path) ?: time())->toIso8601String(),
                ]);
            }
        }

        return $stats;
    }

    /** @return iterable<array{0: string, 1: string}> [absolute path, path relative to Notes/] */
    private function noteFiles(string $base): iterable
    {
        if (! is_dir($base.'/Notes')) {
            return;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($base.'/Notes', \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($iterator as $file) {
            if (! $file->isFile() || ! in_array($file->getExtension(), ['md', 'txt'], true)) {
                continue;
            }

            $relative = substr($file->getPathname(), strlen($base.'/Notes/'));

            // Attachment sidecars become attachments, not notes; trash
            // stays behind unless explicitly requested.
            if (str_contains($relative, '_attachments/')) {
                continue;
            }

            if (str_starts_with($relative, '@Trash/') && ! $this->option('include-trash')) {
                continue;
            }

            yield [$file->getPathname(), $relative];
        }
    }

    /** NotePlan simplified markers -> Donote dialect; tabs -> 4 spaces. */
    private function convertSyntax(string $content): string
    {
        $lines = explode("\n", str_replace("\r\n", "\n", $content));

        foreach ($lines as $i => $line) {
            $indentLength = strspn($line, " \t");
            $indent = str_replace("\t", '    ', substr($line, 0, $indentLength));
            $rest = substr($line, $indentLength);

            if (preg_match('/^\* \[([ x>\-])\] (.*)$/u', $rest, $m)) {
                $rest = "- [{$m[1]}] {$m[2]}";
            } elseif (preg_match('/^\* (?!\*)(.*)$/u', $rest, $m)) {
                $rest = "- [ ] {$m[1]}";
            } elseif (preg_match('/^\+ \[([ x>\-])\] (.*)$/u', $rest, $m)) {
                $rest = "+ [{$m[1]}] {$m[2]}";
            } elseif (preg_match('/^\+ (?!\[)(.*)$/u', $rest, $m)) {
                $rest = "+ [ ] {$m[1]}";
            }

            $lines[$i] = $indent.$rest;
        }

        return implode("\n", $lines);
    }

    /**
     * Pull the title out of the first `# Heading` after optional front
     * matter, removing it from the body.
     *
     * @return array{0: string, 1: string}
     */
    private function extractTitle(string $content, string $fallback): array
    {
        $lines = explode("\n", $content);
        $start = 0;

        if ($lines[0] === '---') {
            for ($i = 1; $i < count($lines); $i++) {
                if (trim($lines[$i]) === '---') {
                    $start = $i + 1;
                    break;
                }
            }
        }

        for ($i = $start; $i < count($lines); $i++) {
            if (trim($lines[$i]) === '') {
                continue;
            }

            if (preg_match('/^# (.+)$/u', $lines[$i], $m)) {
                array_splice($lines, $i, 1);

                if (isset($lines[$i]) && trim($lines[$i]) === '') {
                    array_splice($lines, $i, 1);
                }

                return [trim($m[1]), implode("\n", $lines)];
            }

            break;
        }

        return [$fallback, $content];
    }

    /**
     * Index every file inside *_attachments directories, keyed by the
     * NFC-normalized "<dir>/<filename>" suffix (macOS reports NFD names;
     * note references use NFC — Cyrillic names never match otherwise).
     *
     * @return array<string, string>
     */
    private function indexAttachmentFiles(string $base): array
    {
        if (! is_dir($base.'/Notes')) {
            return [];
        }

        $index = [];
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($base.'/Notes', \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($iterator as $file) {
            if (! $file->isFile()) {
                continue;
            }

            $dir = basename(dirname($file->getPathname()));

            if (! str_ends_with($dir, '_attachments')) {
                continue;
            }

            $key = Normalizer::normalize($dir.'/'.$file->getFilename(), Normalizer::FORM_C);

            if (is_string($key)) {
                $index[$key] = $file->getPathname();
            }
        }

        return $index;
    }

    /**
     * Upload referenced attachment files and rewrite their markdown links
     * to relative /api URLs (images keep the ! marker, other files lose it).
     *
     * @param  array<string, string>  $index
     * @param  array<string, string>  $uploadedUrls
     * @param  array<string, int>  $stats
     */
    private function rewriteAttachmentRefs(
        string $content,
        array $index,
        array &$uploadedUrls,
        Team $team,
        User $user,
        array &$stats,
        bool $dryRun,
    ): string {
        return (string) preg_replace_callback(
            '/(!?)\[([^\]\n]*)\]\(([^)\s]*_attachments\/[^)\s]+)\)/u',
            function (array $m) use (&$uploadedUrls, &$stats, $index, $team, $user, $dryRun): string {
                $decoded = Normalizer::normalize(rawurldecode($m[3]), Normalizer::FORM_C);
                $key = null;

                if (is_string($decoded)) {
                    foreach ($index as $candidate => $path) {
                        if (str_ends_with($decoded, $candidate) || str_ends_with($candidate, $decoded)) {
                            $key = $candidate;
                            break;
                        }
                    }
                }

                if ($key === null) {
                    $stats['unresolved']++;

                    return $m[0];
                }

                if (! isset($uploadedUrls[$key])) {
                    $stats['attachments']++;

                    if ($dryRun) {
                        $uploadedUrls[$key] = '/api/'.$team->slug.'/attachments/dry-run';
                    } else {
                        $path = $index[$key];
                        $name = basename($path);
                        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                        $stored = Storage::putFile('attachments/'.$team->id, new File($path));

                        $attachment = Attachment::create([
                            'team_id' => $team->id,
                            'user_id' => $user->id,
                            'note_id' => null,
                            'name' => $name,
                            'path' => (string) $stored,
                            'mime' => self::MIMES[$extension] ?? (mime_content_type($path) ?: 'application/octet-stream'),
                            'size' => filesize($path) ?: 0,
                        ]);

                        $uploadedUrls[$key] = route('attachments.show', [
                            'current_team' => $team,
                            'attachment' => $attachment,
                        ], false);
                    }
                }

                $filename = basename(rawurldecode($m[3]));
                $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
                $isImage = in_array($extension, self::IMAGE_EXTENSIONS, true);
                $label = $m[2] === '' || $m[2] === 'file' ? $filename : $m[2];
                $bang = $isImage && $m[1] === '!' ? '!' : '';

                return $bang.'['.str_replace(['[', ']'], '', $label).']('.$uploadedUrls[$key].')';
            },
            $content,
        );
    }

    /**
     * Map a NotePlan calendar filename to [note type, date key].
     *
     * @return array{0: string, 1: string}|null
     */
    private function calendarKey(string $filename): ?array
    {
        return match (1) {
            preg_match('/^(\d{4})(\d{2})(\d{2})$/', $filename, $m) => ['daily', "{$m[1]}-{$m[2]}-{$m[3]}"],
            preg_match('/^(\d{4})-W(\d{2})$/', $filename, $m) => ['weekly', "{$m[1]}-W{$m[2]}"],
            preg_match('/^(\d{4})-(\d{2})$/', $filename, $m) => ['monthly', "{$m[1]}-{$m[2]}"],
            preg_match('/^(\d{4})-Q([1-4])$/', $filename, $m) => ['quarterly', "{$m[1]}-Q{$m[2]}"],
            preg_match('/^(\d{4})$/', $filename, $m) => ['yearly', $m[1]],
            default => null,
        };
    }
}
