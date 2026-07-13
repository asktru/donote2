<?php

namespace App\Http\Requests;

use App\Models\Team;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateNoteShareRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $team = $this->route('current_team');
        $teamId = $team instanceof Team ? $team->id : null;

        return [
            'team_readable' => ['required', 'boolean'],
            'shares' => ['present', 'array'],
            'shares.*.user_id' => [
                'required',
                'integer',
                Rule::exists('team_members', 'user_id')->where('team_id', $teamId),
            ],
            'shares.*.access' => ['required', Rule::in(['read', 'write'])],
        ];
    }
}
