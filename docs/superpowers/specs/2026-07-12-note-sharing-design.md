# Note Sharing & Permissions — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design), ready for implementation planning

## Goal

Let a team member share an individual **note** with teammates, either
**read-only** or **read-write**, on top of the existing private-by-default
model. Folders stay ephemeral (no folder entity, no folder permissions), and
calendar notes are out of scope.

## Background (current system, verified)

- Notes carry both `team_id` and `user_id`; every query is scoped by
  `Note::scopeForWorkspace($team, $user)`. So each `(team, user)` is a fully
  **private, isolated workspace** — no content is team-visible today, and
  there is no sharing mechanism. "Private by default" already holds.
- **Folders are not records.** A folder is the `notes.folder` string path;
  empty folders live only in the client IndexedDB `meta` table and never sync.
  We are NOT giving folders identity or permissions.
- **Sync** is a per-`(team,user)` `server_seq` cursor pull + a dirty-note push.
  Conflict resolution is **whole-note last-write-wins** by `client_updated_at`
  (`base_version` match is a fast-forward; otherwise newest timestamp wins;
  the loser is discarded — no merge). One Dexie DB per `(teamSlug, userId)`.
- Calendar notes are `type != 'note'` with a `date_key`; regular notes are
  `type = 'note'`, `date_key = null`.
- There is **no note/folder authorization** today (no Policy/Gate).

## Scope & decisions

- Shareable unit: a **regular note** (`type = 'note'`) only. Not calendar
  notes, not folders.
- **Read-only** share: only the author edits; recipients receive the note via
  sync and never write back. Audience is either **a specific set of
  teammates** or **team-public** (any current or future team member).
- **Read-write** share: never public; always a **fixed set** of teammates.
  Editable by a collaborator **only while online** — offline is read-only, and
  there is no offline edit queue for shared notes (edits sync near-immediately
  through the normal push, or are simply not made).
- **Author-only** manages sharing/permissions and is the **only** deleter.
  Collaborators (even write) cannot re-share, change permissions, or delete.
- Concurrent edits use the existing **whole-note last-write-wins**. Accepted.
- **No Owner/Admin override** in v1 (flat model): admins see only what they
  authored or what is shared with them.
- Revocation strategy: **broadened pull + periodic authoritative-id
  reconcile** (Approach B).

## Data model

### `note_shares` (new table)

| Column      | Type                            | Notes                        |
| ----------- | ------------------------------- | ---------------------------- |
| `id`        | bigint PK                       |                              |
| `note_id`   | uuid FK → notes, cascade delete |                              |
| `user_id`   | bigint FK → users, cascade delete | the recipient              |
| `access`    | enum(`read`,`write`)            |                              |
| timestamps  |                                 |                              |

Unique `(note_id, user_id)`; index `(user_id)`.

### `notes.team_readable` (new column)

Boolean, default `false`. `true` = any team member may read (team-public
read-only). There is no team-writable flag — read-write is never public.

### Effective access (computed, not stored)

For viewer `V` on note `N` authored by `A` in team `T`:

1. `V == A` → **owner** (read/write/delete/share/manage)
2. else `note_shares(N, V, 'write')` → **write** (edit while online; no delete/share)
3. else `note_shares(N, V, 'read')` → **read**
4. else `N.team_readable` → **read**
5. else → **none**

`team_readable` and explicit `write` shares coexist ("anyone can view; Alice
can edit"). A `NoteAccess` enum (`owner|write|read|none`) represents this.

## Server

- `Note::scopeVisibleTo($team, $user)`:
  `team_id = T AND (user_id = V OR team_readable = true OR EXISTS note_shares(note_id, V))`.
  Replaces `forWorkspace` in the **pull** (`NoteSyncController@index`) and
  **search** (`NoteSearchController`) queries. Own notes of all types remain
  included, so calendar sync is unaffected.
- **Pull** keeps the `server_seq` cursor unchanged. Any change to a note's
  sharing **bumps `server_seq`** (touch the note) so recipients pull it next
  cycle and dropped recipients are pruned via reconcile.
- **`ApplyNoteChange`** (push): resolve the note via the visible scope; permit
  content `update` only for `owner`/`write`; permit `delete` only for `owner`;
  permit `create` only as self (`user_id = V`); otherwise `abort(403)`. Sharing
  fields are never mutated through the note push — only via the share endpoint.
- **Reconcile endpoint** `GET /api/{current_team}/notes/visible-ids` → `{ ids: string[] }`
  (all note ids currently visible to `V`). Authorized by team membership.
- **Share endpoint** `PUT /api/{current_team}/notes/{note}/share` (author only):
  body `{ team_readable: bool, shares: [{ user_id, access: 'read'|'write' }] }`.
  Replaces the note's entire share set; validates each `user_id` is a member of
  the team; sets `team_readable`; bumps `server_seq`. Returns the updated
  sharing state.
- **`NotePolicy`** (new, registered): `view` (access ≠ none), `update`
  (owner/write), `delete` (owner), `share` (owner). Invoked from the sync
  controller/action, search, and share endpoint.
- **`NoteResource`** gains `author_id` and computed `access` (for the
  requesting user). When the requesting user is the author, it also carries the
  note's sharing state (`team_readable` + `[{ user_id, access }]`) for the
  dialog; non-authors do not receive the recipient list.
- **Search** returns only notes visible to the requester. Scout is filtered by
  `team_id`, then results are constrained to the visible-id set in PHP (the
  `note_shares` subquery is not expressible as a Scout `where`).

## Client

- `LocalNote` gains `authorId: string` and `access: 'owner' | 'write' | 'read'`
  (own notes default `owner`). Sync `absorb`/`applyServerNote` set these from
  the resource.
- **Prune (reconcile):** after a pull catches up — and on startup, after any
  share change, and on a slow timer — call `visible-ids` and delete every local
  note that is **not dirty** and whose id is **absent** from the set. Dirty
  notes are never pruned (protects a brand-new owner note not yet pushed, and a
  `write` note mid-push). Synced owner notes are always in the set, so in
  practice this only removes revoked shared notes.
- **Push** only sends dirty notes whose access is `owner` or `write`.
- **Editability:**
  - `read` → editor always read-only.
  - `write` → editable only when `navigator.onLine`; offline → read-only with a
    hint. Uses the normal debounced dirty→push path (near-immediate). Because
    editing is disabled offline, nothing queues offline.
  - `owner` → unchanged (full offline editing).
- Non-owner notes: hide delete and move-to-folder affordances.

## UI

- **Share dialog** (author only), from the note header: a "Anyone in the team
  can view" toggle + a teammate picker with per-person Read/Edit; saves via the
  share endpoint. Needs a team-members list (reuse existing team membership
  data/endpoint).
- **Note header indicators:** a people icon + recipient count on notes you have
  shared; on a note shared *to* you, a "Shared by {author} · Read / Can edit"
  badge plus the read-only/offline state.
- **"Shared with me" sidebar section:** lists notes explicitly shared to the
  viewer (kept out of the viewer's own folder tree — folders are the author's
  private structure). Team-public notes are reachable via search / wiki-links
  but are **not** auto-listed (avoids clutter).

## Edge cases

- Author deleted / leaves team → notes cascade-delete → vanish for
  collaborators (reconcile prunes).
- Collaborator leaves team → visibility requires membership, so access drops;
  reconcile prunes.
- Revoke a share / flip team-public → private → reconcile prunes on the
  affected client.
- `read` notes never become dirty; a `write` note revoked mid-edit fails its
  push (403) and the local copy is discarded + pruned.

## Testing

- **Pest (feature):** visibility scope matrix (own / team_readable / read share
  / write share / none); pull includes shared notes; push authz (write edits,
  read cannot, non-author cannot delete, only author shares); share-endpoint
  validation (members only, author only); `visible-ids` correctness.
- **Vitest:** access computation, prune/reconcile logic, editability rule
  (online/offline × access).
- **Playwright:** author shares read/write to a second user (simulated via a
  second Dexie/API context); recipient sees the correct mode; revoke removes
  the note.

## Out of scope (v1)

- Folder-level permissions / folder identity.
- Sharing calendar notes.
- Owner/Admin god-mode override.
- Real-time co-editing / soft locks (LWW accepted).
- Offline editing of shared notes.
