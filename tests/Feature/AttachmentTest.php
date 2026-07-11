<?php

use App\Models\Attachment;
use App\Models\Note;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

test('users can upload an attachment and download it back', function () {
    Storage::fake();

    $user = User::factory()->create();
    $team = $user->currentTeam;

    $response = $this->actingAs($user)
        ->post(route('attachments.store', $team), [
            'file' => UploadedFile::fake()->image('diagram.png', 100, 100),
        ])
        ->assertCreated()
        ->assertJsonPath('name', 'diagram.png');

    $attachment = Attachment::query()->findOrFail($response->json('id'));

    Storage::assertExists($attachment->path);

    $this->actingAs($user)
        ->get($response->json('url'))
        ->assertSuccessful();
});

test('attachments are linked to a note when the note belongs to the workspace', function () {
    Storage::fake();

    $user = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
    ]);

    $response = $this->actingAs($user)
        ->post(route('attachments.store', $user->currentTeam), [
            'file' => UploadedFile::fake()->create('spec.pdf', 10, 'application/pdf'),
            'note_id' => $note->id,
        ])
        ->assertCreated();

    expect(Attachment::query()->findOrFail($response->json('id'))->note_id)->toBe($note->id);
});

test('users cannot download attachments of other users', function () {
    Storage::fake();

    $owner = User::factory()->create();
    $attachment = Attachment::factory()->create([
        'team_id' => $owner->currentTeam->id,
        'user_id' => $owner->id,
    ]);

    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->get(route('attachments.show', [
            'current_team' => $stranger->currentTeam,
            'attachment' => $attachment,
        ]))
        ->assertNotFound();
});

test('uploads larger than the limit are rejected', function () {
    Storage::fake();

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('attachments.store', $user->currentTeam), [
            'file' => UploadedFile::fake()->create('huge.zip', 60000),
        ])
        ->assertUnprocessable();
});
