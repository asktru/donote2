<?php

namespace Database\Factories;

use App\Models\GoogleAccount;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<GoogleAccount>
 */
class GoogleAccountFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'email' => $this->faker->unique()->safeEmail(),
            'access_token' => 'access-token',
            'refresh_token' => 'refresh-token',
            'token_expires_at' => now()->addHour(),
            'calendars' => [
                [
                    'id' => 'primary',
                    'summary' => 'Personal',
                    'color' => '#9a9cff',
                    'primary' => true,
                    'selected' => true,
                ],
                [
                    'id' => 'work@group.calendar.google.com',
                    'summary' => 'Work',
                    'color' => '#f83a22',
                    'primary' => false,
                    'selected' => false,
                ],
            ],
        ];
    }
}
