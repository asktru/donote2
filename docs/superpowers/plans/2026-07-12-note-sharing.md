# Note Sharing & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a note's author share an individual regular note with teammates read-only (specific set or team-public) or read-write (fixed set, online-only edits), on top of the private-by-default model.

**Architecture:** A `note_shares` pivot + a `notes.team_readable` flag drive a computed `NoteAccess` (owner/write/read/none). The pull query broadens from `forWorkspace` to `scopeVisibleTo`; a `visible-ids` reconcile endpoint prunes revoked notes on the client. Author-only share management via `PUT .../share`. Whole-note LWW retained.

**Tech Stack:** Laravel 13, Pest; Inertia v3 + Vue 3; Dexie (IndexedDB); Vitest; Meilisearch/Scout.

## Global Constraints

- Shareable unit = regular note (`type = 'note'`) only. Never calendar notes, never folders.
- Author-only for share/permission changes and delete. Collaborators cannot re-share, re-permission, or delete.
- Read-write is never team-public. Team-public applies to read-only only.
- Collaborator edits allowed only while `navigator.onLine`; offline = read-only; no offline queue for shared notes.
- Concurrent edits: existing whole-note last-write-wins. No merge, no locks.
- No Owner/Admin override (flat model).
- Run `vendor/bin/pint --dirty --format agent` after PHP edits; `php artisan test --compact --filter=...` for tests; `npx vue-tsc --noEmit`, `npx eslint`, `npx vitest run`, `npm run build` for frontend.

---

## File Structure

- `database/migrations/*_create_note_shares_table.php` — new pivot + `team_readable` column.
- `app/Enums/NoteAccess.php` — owner|write|read|none.
- `app/Models/NoteShare.php` — pivot model.
- `app/Models/Note.php` — `shares()`, `scopeVisibleTo`, `accessFor(User): NoteAccess`, `touchServerSeq()`.
- `app/Policies/NotePolicy.php` — view/update/delete/share.
- `app/Http/Controllers/NoteSyncController.php` — pull uses visible scope.
- `app/Actions/Notes/ApplyNoteChange.php` — push authz.
- `app/Http/Resources/NoteResource.php` — `author_id`, `access`, author-only sharing state.
- `app/Http/Controllers/NoteShareController.php` — `show`, `update` (PUT), + `NoteVisibleIdsController` (or method) for reconcile.
- `app/Http/Requests/UpdateNoteShareRequest.php`.
- `routes/web.php` — share, visible-ids routes.
- `resources/js/stores/db.ts` — `LocalNote` gains `authorId`, `access`; Dexie version bump.
- `resources/js/stores/sync.ts` — set author/access on absorb; push filter; reconcile prune.
- `resources/js/stores/workspace.ts` — `applyServerNote` maps author/access; `sharedNotes` computed; access helpers.
- `resources/js/lib/noteAccess.ts` — client access typing + editability helper + Vitest.
- `resources/js/components/notes/ShareDialog.vue` — share UI.
- `resources/js/components/notes/NotePane.vue` / note header — share button + badges + read-only wiring.
- `resources/js/components/editor/MarkdownEditor.vue` — `readOnly` prop.
- `resources/js/components/notes/NotesSidebar.vue` — "Shared with me" section.

---

## Task 1: Schema — `note_shares` + `team_readable`

**Files:**
- Create: `database/migrations/2026_07_12_000001_create_note_shares_table.php`
- Modify: `app/Models/Note.php`
- Create: `app/Models/NoteShare.php`, `app/Enums/NoteAccess.php`, `database/factories/NoteShareFactory.php`
- Test: `tests/Feature/NoteShareModelTest.php`

**Produces:** `note_shares(note_id uuid, user_id, access)`, `notes.team_readable bool`, `Note::shares()` HasMany, `NoteAccess` enum, `NoteShare` model.

- [ ] Migration `up()`:
```php
Schema::create('note_shares', function (Blueprint $table) {
    $table->id();
    $table->foreignUuid('note_id')->constrained()->cascadeOnDelete();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('access', 8); // 'read' | 'write'
    $table->timestamps();
    $table->unique(['note_id', 'user_id']);
    $table->index('user_id');
});
Schema::table('notes', function (Blueprint $table) {
    $table->boolean('team_readable')->default(false);
});
```
- [ ] `NoteAccess` enum: `case Owner='owner'; case Write='write'; case Read='read'; case None='none';` with `canWrite(): bool` (owner||write), `canRead(): bool` (!== none), `isOwner(): bool`.
- [ ] `NoteShare` model: `$fillable = ['note_id','user_id','access']`, `$casts = ['access' => NoteAccess is NOT used here — store raw string]`; belongsTo note & user. (Keep `access` a plain string to avoid enum-with-none in the pivot; only read/write ever stored.)
- [ ] `Note`: add `team_readable` to `$fillable`, cast `'team_readable' => 'boolean'`; `shares(): HasMany` → NoteShare.
- [ ] Test: create note + share row; assert relation loads; assert `team_readable` casts to bool; migration fresh runs.
- [ ] Run: `php artisan migrate --no-interaction` then `php artisan test --compact --filter=NoteShareModel`. Commit.

---

## Task 2: Access resolution + policy

**Files:**
- Modify: `app/Models/Note.php` (`scopeVisibleTo`, `accessFor`, `touchServerSeq`)
- Create: `app/Policies/NotePolicy.php`
- Modify: `app/Providers/AppServiceProvider.php` (register policy if not auto-discovered)
- Test: `tests/Feature/NoteAccessTest.php`

**Interfaces produced:**
- `Note::scopeVisibleTo(Builder, Team, User): Builder`
- `Note::accessFor(User): NoteAccess`
- `Note::touchServerSeq(): void` — sets `server_seq = nextServerSeq()` and saves without touching timestamps.
- `NotePolicy@view|update|delete|share(User, Note): bool`

- [ ] `scopeVisibleTo`:
```php
public function scopeVisibleTo(Builder $query, Team $team, User $user): Builder
{
    return $query->whereBelongsTo($team)->where(function (Builder $q) use ($user) {
        $q->where('user_id', $user->id)
          ->orWhere('team_readable', true)
          ->orWhereHas('shares', fn (Builder $s) => $s->where('user_id', $user->id));
    });
}
```
- [ ] `accessFor(User $user): NoteAccess`:
```php
public function accessFor(User $user): NoteAccess
{
    if ($this->user_id === $user->id) return NoteAccess::Owner;
    $share = $this->shares->firstWhere('user_id', $user->id);
    if ($share?->access === 'write') return NoteAccess::Write;
    if ($share !== null) return NoteAccess::Read;
    if ($this->team_readable) return NoteAccess::Read;
    return NoteAccess::None;
}
```
(Callers should eager-load `shares` to avoid N+1.)
- [ ] `touchServerSeq()`: `$this->server_seq = self::nextServerSeq(); $this->timestamps=false; $this->save(); $this->timestamps=true;`
- [ ] `NotePolicy`: `view` → `accessFor->canRead()`; `update` → `canWrite()`; `delete` → `isOwner()`; `share` → `isOwner()`. Each also asserts the note belongs to `$user->currentTeam()` (defense).
- [ ] Tests (dataset over the 5 access cases): owner/write/read-share/team_readable/none map to expected `NoteAccess`; policy allows/denies accordingly.
- [ ] Run `--filter=NoteAccess`, pint, commit.

---

## Task 3: Pull + NoteResource

**Files:**
- Modify: `app/Http/Controllers/NoteSyncController.php`
- Modify: `app/Http/Resources/NoteResource.php`
- Test: `tests/Feature/NoteSyncPullSharingTest.php`

**Interfaces:** pull returns notes `visibleTo($team,$user)`; `NoteResource` adds `author_id` (int), `access` (string from `accessFor`), and — only when `$user->id === note->user_id` — `sharing: { team_readable: bool, shares: [{user_id, access}] }`.

- [ ] Pull query: replace `->forWorkspace($current_team, $request->user())` with `->visibleTo($current_team, $request->user())` and `->with('shares')`.
- [ ] `NoteResource::toArray`: add
```php
'author_id' => $this->user_id,
'access' => $this->accessFor($request->user())->value,
$this->mergeWhen($this->user_id === $request->user()->id, fn () => [
    'sharing' => [
        'team_readable' => $this->team_readable,
        'shares' => $this->shares->map(fn ($s) => ['user_id' => $s->user_id, 'access' => $s->access])->values(),
    ],
]),
```
- [ ] Tests: author A shares note read to B and write to C; pull as B sees it with `access:'read'` and no `sharing`; as C `access:'write'`; as D (no share, not team_readable) does NOT see it; team_readable note seen by all with `access:'read'`; pull as A includes `sharing`.
- [ ] Run `--filter=NoteSyncPullSharing`, pint, commit.

---

## Task 4: Push authorization

**Files:**
- Modify: `app/Actions/Notes/ApplyNoteChange.php`
- Test: `tests/Feature/NoteSyncPushSharingTest.php`

**Interface change:** resolve the note via `visibleTo` (not `forWorkspace`); enforce: update requires `canWrite()`; delete requires `isOwner()`; a `create` is always stamped `user_id = $user->id`; forbidden ops `abort(403)`.

- [ ] In `execute`, change the lookup to `Note::withTrashed()->visibleTo($team, $user)->with('shares')->find($id)`.
- [ ] After resolving an existing `$note`: compute `$access = $note->accessFor($user)`. If change is a delete (`$change['deleted']` and note not trashed) require `$access->isOwner()` else `abort(403)`. For content update require `$access->canWrite()` else `abort(403)`. (Author edits unchanged.)
- [ ] Keep the "belongs to another workspace" 403 for the truly-invisible case: if `$note === null && Note::withTrashed()->whereKey($id)->exists()` → still `abort(403)`.
- [ ] `create()` unchanged (stamps `$user->id`), so a collaborator can't fabricate someone else's note.
- [ ] Tests: write-collaborator C edits content → applied, `version` bumps; read-recipient B pushes an edit → 403; non-owner delete → 403 and note survives; owner delete → trashed; author edit still works.
- [ ] Run `--filter=NoteSyncPushSharing`, pint, commit.

---

## Task 5: Share endpoint

**Files:**
- Create: `app/Http/Controllers/NoteShareController.php`, `app/Http/Requests/UpdateNoteShareRequest.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/NoteShareEndpointTest.php`

**Routes** (inside the existing `api/{current_team}` group, `['auth','verified',EnsureTeamMembership]`):
```php
Route::get('notes/{note}/share', [NoteShareController::class, 'show'])->name('notes.share.show');
Route::put('notes/{note}/share', [NoteShareController::class, 'update'])->name('notes.share.update');
```
(`{note}` binds by uuid; controller must `$this->authorize('share', $note)` and assert team match.)

**Request validation** (`UpdateNoteShareRequest`):
```php
'team_readable' => ['required','boolean'],
'shares' => ['array'],
'shares.*.user_id' => ['required','integer', Rule::exists('team_members','user_id')->where('team_id', $this->route('current_team')->id)],
'shares.*.access' => ['required', Rule::in(['read','write'])],
```
Plus: reject if note `type !== 'note'` (calendar/other not shareable) → 422; reject a share row where `user_id === note->user_id` (can't share to self).

- [ ] `update()`: `authorize('share', $note)`; wrap in a transaction — set `team_readable`, delete existing shares, re-insert from payload; `$note->touchServerSeq()`; return `show()` payload.
- [ ] `show()`: `authorize('share', $note)` (author-only view of the recipient list); return `{ team_readable, shares: [{user_id, access}] }`.
- [ ] Tests: author sets team_readable + [B:read, C:write] → rows persisted, server_seq bumped; non-author PUT → 403; share to non-member → 422; share a calendar note → 422; empty shares clears the set.
- [ ] Run `--filter=NoteShareEndpoint`, pint, commit.

---

## Task 6: `visible-ids` reconcile endpoint

**Files:**
- Modify: `app/Http/Controllers/NoteSyncController.php` (add `visibleIds` method) + route.
- Test: `tests/Feature/NoteVisibleIdsTest.php`

**Route:** `Route::get('notes/visible-ids', [NoteSyncController::class, 'visibleIds'])->name('notes.visible-ids');`

- [ ] `visibleIds(Request, Team)`: `return ['ids' => Note::visibleTo($team, $request->user())->pluck('id')];` (includes non-trashed only — trashed notes are removed via the normal deleted-flag pull; reconcile only prunes access-loss).
- [ ] Test: A authors n1; shares n2(read) from B; team_readable n3 from C; private n4 from D. `visible-ids` as A = {n1, n2? no}. Precisely: as A returns A's own + shared-to-A + team_readable. Assert set membership for a constructed fixture.
- [ ] Run `--filter=NoteVisibleIds`, pint, commit.

---

## Task 7: Search visibility

**Files:**
- Modify: `app/Http/Controllers/NoteSearchController.php`
- Test: `tests/Feature/NoteSearchSharingTest.php`

- [ ] After Scout `->where('team_id', $team->id)->get()`, filter the collection to those whose id is in `Note::visibleTo($team,$user)->pluck('id')` (query once, use a Set). Drop the `->where('user_id', ...)` Scout constraint.
- [ ] Test (may use `SCOUT_DRIVER=collection` or the existing search test harness): a note shared to B appears in B's search; a private note of A does not appear for B.
- [ ] Run `--filter=NoteSearchSharing`, pint, commit.

---

## Task 8: Team-members list for the picker

**Files:**
- Check first: does an endpoint returning team members exist (team settings)? Search `routes/web.php`, team controllers.
- If missing: add `Route::get('members', ...)` under `api/{current_team}` returning `[{id, name, email}]` for the team.
- Test: `tests/Feature/TeamMembersEndpointTest.php` (only if new).

- [ ] Implement/confirm; a member list is needed by the ShareDialog. Prefer reusing Inertia-provided team data if the notes page already receives members; otherwise the endpoint.
- [ ] Commit.

---

## Task 9: Client sync — author/access + reconcile prune

**Files:**
- Modify: `resources/js/stores/db.ts`, `resources/js/stores/sync.ts`, `resources/js/stores/workspace.ts`
- Create: `resources/js/lib/noteAccess.ts` + `resources/js/lib/noteAccess.test.ts`
- Test: `resources/js/stores/sync.reconcile.test.ts` (pure prune fn)

**Interfaces produced:**
- `LocalNote.authorId: string` (the note's `user_id` as string), `LocalNote.access: 'owner'|'write'|'read'`.
- `noteAccess.ts`: `canEditNote(access, online): boolean` — `access==='owner' || (access==='write' && online)`.
- `sync.ts`: `notesToPrune(localIds: string[], visibleIds: Set<string>, dirtyIds: Set<string>): string[]` — ids in localIds not in visibleIds and not in dirtyIds.

- [ ] `db.ts`: bump Dexie version; add `authorId`, `access` to `LocalNote` and the store definition (they're not indexed, so a version bump with the same stores + an upgrade populating defaults `access:'owner'`, `authorId: currentUserId` for existing rows).
- [ ] `ServerNote` type + `applyServerNote`: map `author_id`→`authorId` (String), `access`→`access`. Default new local (owned) notes to `access:'owner'`, `authorId: currentUserId`.
- [ ] `sync.ts` push: filter `dirtyNotes()` to `note.access !== 'read'` (never push read-only). (Owner + write only.)
- [ ] Reconcile: add `reconcileVisibility()` — `GET {base}/notes/visible-ids`, compute `notesToPrune`, `removeLocalNote` each. Call it at the end of `syncNow()` after pull, and expose for the share-change hook.
- [ ] Vitest: `canEditNote` truth table; `notesToPrune` (prunes revoked, keeps dirty, keeps visible).
- [ ] Run vitest for the two files, tsc, commit.

---

## Task 10: Editor read-only / offline

**Files:**
- Modify: `resources/js/components/editor/MarkdownEditor.vue` (add `readOnly` prop → CM `EditorState.readOnly` + `EditorView.editable`), `resources/js/components/notes/NotePane.vue` (compute readOnly from note access + online).
- Modify: `resources/js/composables/useOnline.ts` (create if absent — reactive `navigator.onLine`).
- Test: `resources/js/lib/noteAccess.test.ts` already covers the rule; component wiring verified in Task 13 browser pass.

- [ ] `useOnline()` composable: reactive ref bound to `online`/`offline` events.
- [ ] `MarkdownEditor` `readOnly` prop → reconfigure CM with `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)` via a compartment so it can toggle when online-ness changes.
- [ ] `NotePane`: `readOnly = !canEditNote(note.access, online.value)`. Pass to editor. Show a small banner for read/offline-write states.
- [ ] tsc, eslint, commit.

---

## Task 11: Share dialog + header indicators

**Files:**
- Create: `resources/js/components/notes/ShareDialog.vue`
- Modify: note header (in `NotePane.vue`) — share button (author only), shared-with-me badge.
- Modify: `resources/js/stores/workspace.ts` — `updateNoteSharing(noteId, { teamReadable, shares })` (PUT endpoint) + `getNoteSharing(noteId)`; trigger `reconcileVisibility()` after.

- [ ] `ShareDialog`: "Anyone in the team can view" toggle + member picker (Read/Edit per member, remove); Save → `updateNoteSharing`. Loads current state via `getNoteSharing` / the note's `sharing` prop.
- [ ] Header: people icon + count when `note.access==='owner'` and shared; badge "Shared by {author} · Read/Can edit" when access !== owner.
- [ ] tsc, eslint, commit.

---

## Task 12: "Shared with me" sidebar section

**Files:**
- Modify: `resources/js/stores/workspace.ts` — `sharedNotes` computed (`liveNotes` where `access !== 'owner'`).
- Modify: `resources/js/components/notes/NotesSidebar.vue` — render a "Shared with me" section above/below folders listing `sharedNotes` (grouped by author name if available), opening the note on click. Own notes stay in the folder tree (exclude `access!=='owner'` from the folder tree so shared notes don't appear twice).

- [ ] Implement; ensure the folder-tree note list filters to `access==='owner'`.
- [ ] tsc, eslint, build, commit.

---

## Task 13: Full verification

- [ ] `vendor/bin/pint --dirty --format agent`; `./vendor/bin/phpstan analyse` (larastan) on changed files; `php artisan test --compact` (full backend suite).
- [ ] `npx vue-tsc --noEmit`; `npx eslint` (changed files); `npx vitest run`; `npm run build`.
- [ ] Playwright: seed via API/second Dexie context — author shares a note read-only to user B and read-write to user C; verify B sees it read-only in "Shared with me", C can edit while online, edits sync; revoke B and confirm the note disappears after reconcile; flip team_readable and confirm a third user sees it.
- [ ] Commit; push.
