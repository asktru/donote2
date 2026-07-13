<?php

namespace Database\Factories;

use App\Models\Note;
use App\Models\NoteShare;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<NoteShare>
 */
class NoteShareFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'note_id' => Note::factory(),
            'user_id' => User::factory(),
            'access' => 'read',
        ];
    }

    /**
     * A read-write share.
     */
    public function write(): static
    {
        return $this->state(fn (): array => ['access' => 'write']);
    }
}
