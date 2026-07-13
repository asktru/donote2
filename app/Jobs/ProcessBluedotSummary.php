<?php

namespace App\Jobs;

use App\Actions\Meetings\FormatBluedotSummary;
use App\Actions\Notes\AppendUnderHeading;
use App\Actions\Notes\WriteNote;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class ProcessBluedotSummary implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $payload  The Bluedot webhook body.
     */
    public function __construct(
        public int $userId,
        public int $teamId,
        public array $payload,
    ) {}

    public function handle(
        WriteNote $writeNote,
        AppendUnderHeading $appendUnderHeading,
        FormatBluedotSummary $formatSummary,
    ): void {
        $user = User::find($this->userId);
        $team = Team::find($this->teamId);

        // The webhook URL is bound to a team; drop the summary if the user
        // has since lost access to it rather than filing it somewhere wrong.
        if ($user === null || $team === null || ! $user->belongsToTeam($team)) {
            return;
        }

        $videoId = (string) ($this->payload['videoId'] ?? '');
        $createdAt = CarbonImmutable::createFromTimestamp(
            (int) ($this->payload['createdAt'] ?? now()->timestamp),
        );
        $dateKey = $createdAt->toDateString();
        $title = $this->resolveTitle($dateKey);

        $summary = (string) (
            $this->payload['summaryV2'] ?? $this->payload['summary'] ?? ''
        );

        $frontMatter = implode("\n", [
            '---',
            'meeting-date: '.$dateKey,
            'attendees: '.implode(', ', (array) ($this->payload['attendees'] ?? [])),
            'meeting-id: '.(string) ($this->payload['meetingId'] ?? ''),
            'video-id: '.$videoId,
            'source: bluedot',
            '---',
        ]);

        $content = $frontMatter."\n".$formatSummary->execute($summary);

        // Bluedot can re-send the same summary; match on the video id so a
        // retry updates the existing note instead of duplicating it.
        $existing = $videoId !== ''
            ? Note::query()
                ->forWorkspace($team, $user)
                ->where('type', 'note')
                ->where('folder', 'Meetings')
                ->where('content', 'like', '%video-id: '.$videoId.'%')
                ->first()
            : null;

        $note = $writeNote->execute($team, $user, $existing, [
            'title' => $title,
            'content' => $content,
            'folder' => 'Meetings',
        ]);

        $this->linkFromDailyNote(
            $writeNote,
            $appendUnderHeading,
            $team,
            $user,
            $dateKey,
            $note->title,
        );
    }

    /** Bluedot usually sends the real meeting name; fall back for opaque ids. */
    private function resolveTitle(string $dateKey): string
    {
        $title = trim((string) ($this->payload['title'] ?? ''));

        if ($title === '' || preg_match('/^[0-9a-f]{24}$/i', $title) === 1) {
            return "Meeting — {$dateKey}";
        }

        return $title;
    }

    private function linkFromDailyNote(
        WriteNote $writeNote,
        AppendUnderHeading $appendUnderHeading,
        Team $team,
        User $user,
        string $dateKey,
        string $title,
    ): void {
        $daily = Note::query()
            ->forWorkspace($team, $user)
            ->where('type', 'daily')
            ->where('date_key', $dateKey)
            ->first();

        $link = "- [[{$title}]]";

        // Don't add the link twice if the meeting is re-sent.
        if ($daily !== null && str_contains($daily->content, $link)) {
            return;
        }

        $content = $appendUnderHeading->execute(
            $daily !== null ? $daily->content : '',
            'Meetings',
            $link,
        );

        $writeNote->execute($team, $user, $daily, [
            'type' => 'daily',
            'date_key' => $dateKey,
            'title' => '',
            'content' => $content,
        ]);
    }
}
