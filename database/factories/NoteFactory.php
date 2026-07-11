<?php

namespace Database\Factories;

use App\Enums\NoteType;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Note>
 */
class NoteFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'id' => (string) Str::uuid(),
            'team_id' => Team::factory(),
            'user_id' => User::factory(),
            'type' => NoteType::Note,
            'date_key' => null,
            'title' => $this->faker->sentence(3),
            'content' => "# {$this->faker->sentence(3)}\n\n{$this->faker->paragraph()}",
            'folder' => '',
            'pinned' => false,
            'version' => 1,
            'server_seq' => 0,
        ];
    }

    /**
     * A daily calendar note for the given date.
     */
    public function daily(?string $dateKey = null): static
    {
        return $this->state(fn (): array => [
            'type' => NoteType::Daily,
            'date_key' => $dateKey ?? now()->toDateString(),
            'title' => '',
        ]);
    }

    /**
     * A weekly calendar note (e.g. 2026-W28).
     */
    public function weekly(?string $dateKey = null): static
    {
        return $this->state(fn (): array => [
            'type' => NoteType::Weekly,
            'date_key' => $dateKey ?? now()->format('o-\WW'),
            'title' => '',
        ]);
    }
}
