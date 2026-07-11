<?php

namespace Database\Factories;

use App\Models\Attachment;
use App\Models\Team;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Attachment>
 */
class AttachmentFactory extends Factory
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
            'note_id' => null,
            'name' => $this->faker->word().'.png',
            'path' => 'attachments/1/'.Str::random(40),
            'mime' => 'image/png',
            'size' => $this->faker->numberBetween(1000, 100000),
        ];
    }
}
