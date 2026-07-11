<?php

namespace Database\Seeders;

use App\Models\Note;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $user = User::query()->where('email', 'test@example.com')->first()
            ?? User::factory()->create([
                'name' => 'Test User',
                'email' => 'test@example.com',
            ]);

        $team = $user->currentTeam;

        if ($team === null) {
            return;
        }

        $seq = (int) Note::withTrashed()->max('server_seq');

        $notes = [
            [
                'type' => 'daily',
                'date_key' => now()->toDateString(),
                'title' => '',
                'folder' => '',
                'content' => implode("\n", [
                    '## Plan for today',
                    '- [ ] !! Review [[AIR Platform 2026 Architecture]] with the team #work @9am',
                    '- [ ] Prepare weekly report >'.now()->format('o-\WW').' @due('.now()->addDays(4)->toDateString().')',
                    '- [ ] Water plants @repeat(3d)',
                    '+ [ ] Pack laptop charger',
                    '+ [ ] Book meeting room',
                    '',
                    '## Notes',
                    '- Met @sarah about the #q3/okrs draft — see [[Team OKRs]]',
                ]),
            ],
            [
                'type' => 'note',
                'date_key' => null,
                'title' => 'AIR Platform 2026 Architecture',
                'folder' => 'Projects',
                'content' => implode("\n", [
                    '---',
                    'type: project',
                    'start: '.now()->subDays(10)->toDateString(),
                    'due: '.now()->addDays(30)->toDateString(),
                    'review: 1w',
                    '---',
                    '# AIR Platform 2026 Architecture',
                    '',
                    'Working document for the platform redesign. Related: [[Team OKRs]]',
                    '',
                    '## Open tasks',
                    '- [ ] !!! Finalize service boundaries >'.now()->addDays(3)->toDateString().' @due('.now()->addDays(10)->toDateString().') #architecture',
                    '- [ ] Draft ADR for event bus #architecture @mike',
                    '    - [ ] Compare Kafka vs. NATS',
                    '    - Notes from spike go here',
                    '- [x] Kickoff meeting with @sarah and @mike',
                ]),
            ],
            [
                'type' => 'note',
                'date_key' => null,
                'title' => 'Team OKRs',
                'folder' => 'OKRs',
                'content' => implode("\n", [
                    '---',
                    'type: area',
                    'review: Sat',
                    '---',
                    '# Team OKRs',
                    '',
                    '## Q3 2026 #q3/okrs',
                    '- [ ] Ship offline sync GA >2026-Q3',
                    '- [ ] Grow weekly active teams by 20% >2026-09',
                    '- [ ] ! Renew SOC2 @due(2026-08-15) @legal',
                ]),
            ],
            [
                'type' => 'note',
                'date_key' => null,
                'title' => 'Reading List',
                'folder' => 'Lists',
                'content' => implode("\n", [
                    '---',
                    'type: list',
                    'review: 2w',
                    '---',
                    '# Reading List',
                    '',
                    '- [x] Team Topologies',
                    '- [ ] Thinking in Systems',
                    '- [ ] The Manager\'s Path',
                    '- [-] Some abandoned book',
                ]),
            ],
            [
                'type' => 'note',
                'date_key' => null,
                'title' => 'Website Redesign',
                'folder' => 'Projects',
                'content' => implode("\n", [
                    '---',
                    'type: project',
                    'start: '.now()->addDays(14)->toDateString(),
                    'due: '.now()->addDays(60)->toDateString(),
                    'review: 2w',
                    '---',
                    '# Website Redesign',
                    '',
                    '- [ ] Kickoff workshop',
                    '- [ ] Moodboards',
                ]),
            ],
            [
                'type' => 'weekly',
                'date_key' => now()->format('o-\WW'),
                'title' => '',
                'folder' => '',
                'content' => implode("\n", [
                    '## Focus this week',
                    '- [ ] Weekly review @repeat(Mon) @8am',
                    '- Big rock: [[AIR Platform 2026 Architecture]]',
                ]),
            ],
        ];

        foreach ($notes as $attributes) {
            Note::query()->firstOrCreate(
                [
                    'team_id' => $team->id,
                    'user_id' => $user->id,
                    'type' => $attributes['type'],
                    'date_key' => $attributes['date_key'],
                    'title' => $attributes['title'],
                ],
                [
                    'content' => $attributes['content'],
                    'folder' => $attributes['folder'],
                    'server_seq' => ++$seq,
                ],
            );
        }
    }
}
