<?php

namespace App\Http\Requests;

use App\Enums\NoteType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SyncNotesRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'changes' => ['required', 'array', 'max:200'],
            'changes.*.id' => ['required', 'uuid'],
            'changes.*.type' => ['required', Rule::enum(NoteType::class)],
            'changes.*.date_key' => ['nullable', 'string', 'max:10'],
            'changes.*.title' => ['present', 'nullable', 'string', 'max:512'],
            'changes.*.content' => ['present', 'nullable', 'string', 'max:2000000'],
            'changes.*.folder' => ['present', 'nullable', 'string', 'max:512'],
            'changes.*.pinned' => ['required', 'boolean'],
            'changes.*.base_version' => ['required', 'integer', 'min:0'],
            'changes.*.deleted' => ['required', 'boolean'],
            'changes.*.client_updated_at' => ['required', 'date'],
        ];
    }
}
