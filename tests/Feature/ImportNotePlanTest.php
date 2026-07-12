<?php

use App\Models\Attachment;
use App\Models\Note;
use App\Models\User;
use Illuminate\Support\Facades\Storage;

function makeNotePlanZip(array $files): string
{
    $path = tempnam(sys_get_temp_dir(), 'np-').'.zip';
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);

    foreach ($files as $name => $content) {
        $zip->addFromString($name, $content);
    }

    $zip->close();

    return $path;
}

test('imports notes, calendar notes, and attachments from a noteplan zip', function () {
    Storage::fake();

    $user = User::factory()->create();
    $zip = makeNotePlanZip([
        'Notes/Projects/Alpha.md' => "---\ntype: project\nreview: 2w\n---\n# Alpha\n\n* Ship the beta\n\t+ notify the team\n- plain bullet\n- [file](Alpha_attachments/spec.txt)\n",
        'Notes/Projects/Alpha_attachments/spec.txt' => 'the spec body',
        'Notes/@Trash/Old.md' => "# Old\ncontent",
        'Notes/Meetings/2026/07/Standup.md' => "# Standup\n* [x] reviewed metrics\n",
        'Calendar/20260701.md' => "* [x] Morning review\n",
        'Calendar/2026-W27.md' => 'Weekly focus',
    ]);

    $this->artisan('donote:import-noteplan', [
        'zip' => $zip,
        '--user' => $user->email,
    ])->assertSuccessful();

    $team = $user->currentTeam;

    $alpha = Note::forWorkspace($team, $user)->where('title', 'Alpha')->firstOrFail();
    expect($alpha->folder)->toBe('Projects')
        ->and($alpha->content)->toContain('type: project')
        ->and($alpha->content)->toContain('- [ ] Ship the beta')
        ->and($alpha->content)->toContain('    + [ ] notify the team')
        ->and($alpha->content)->toContain('- plain bullet')
        ->and($alpha->content)->toMatch('#\[spec\.txt\]\(/api/[\w-]+/attachments/[\w-]+\)#');

    // Meetings are included; trash is not.
    expect(Note::forWorkspace($team, $user)->where('title', 'Standup')->exists())->toBeTrue()
        ->and(Note::forWorkspace($team, $user)->where('title', 'Old')->exists())->toBeFalse();

    $daily = Note::forWorkspace($team, $user)->where('type', 'daily')->where('date_key', '2026-07-01')->firstOrFail();
    expect($daily->content)->toContain('- [x] Morning review');

    $weekly = Note::forWorkspace($team, $user)->where('type', 'weekly')->where('date_key', '2026-W27')->firstOrFail();
    expect($weekly->content)->toContain('Weekly focus');

    $attachment = Attachment::query()->where('name', 'spec.txt')->firstOrFail();
    Storage::assertExists($attachment->path);

    unlink($zip);
});

test('re-running the import skips notes that already exist', function () {
    Storage::fake();

    $user = User::factory()->create();
    $zip = makeNotePlanZip([
        'Notes/Ideas.md' => "# Ideas\n* capture more\n",
    ]);

    $this->artisan('donote:import-noteplan', ['zip' => $zip, '--user' => $user->email])->assertSuccessful();
    $this->artisan('donote:import-noteplan', ['zip' => $zip, '--user' => $user->email])->assertSuccessful();

    expect(Note::forWorkspace($user->currentTeam, $user)->where('title', 'Ideas')->count())->toBe(1);

    unlink($zip);
});
