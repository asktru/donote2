<?php

namespace App\Http\Controllers;

use App\Models\GoogleAccount;
use App\Models\User;
use App\Services\GoogleCalendarClient;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;

class CalendarEventController extends Controller
{
    /**
     * Create an event on one of the user's Google calendars.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validateEvent($request, creating: true);
        $account = $this->accountForCalendar($request->user(), $data['calendar_id']);

        abort_if($account === null, 422, 'That calendar is not connected.');

        $event = (new GoogleCalendarClient($account))->insertEvent(
            $data['calendar_id'],
            $this->buildBody($data),
            $request->boolean('add_meet'),
        );

        return response()->json(['event' => $this->mapEvent($event)]);
    }

    /**
     * Patch an existing event.
     */
    public function update(Request $request): JsonResponse
    {
        $data = $this->validateEvent($request, creating: false);
        $account = $this->accountForCalendar($request->user(), $data['calendar_id']);

        abort_if($account === null, 422, 'That calendar is not connected.');

        $event = (new GoogleCalendarClient($account))->patchEvent(
            $data['calendar_id'],
            $data['event_id'],
            $this->buildBody($data),
        );

        return response()->json(['event' => $this->mapEvent($event)]);
    }

    /**
     * Delete an event.
     */
    public function destroy(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'calendar_id' => ['required', 'string'],
            'event_id' => ['required', 'string'],
        ]);

        $account = $this->accountForCalendar($request->user(), $validated['calendar_id']);

        abort_if($account === null, 422, 'That calendar is not connected.');

        (new GoogleCalendarClient($account))->deleteEvent(
            $validated['calendar_id'],
            $validated['event_id'],
        );

        return response()->json(['deleted' => true]);
    }

    /**
     * Search the user's Google Workspace directory (invitee autocomplete).
     */
    public function directory(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => ['required', 'string', 'min:1', 'max:100'],
        ]);

        $account = $request->user()->googleAccounts()->first();

        abort_if($account === null, 422, 'Connect a Google account first.');

        try {
            return response()->json([
                'people' => (new GoogleCalendarClient($account))->searchDirectory(
                    $validated['q'],
                ),
            ]);
        } catch (\Throwable $e) {
            // Keep the field usable (raw emails still work) but tell the user
            // why suggestions are empty — almost always the People API not
            // being enabled, or the directory.readonly scope not granted.
            Log::warning('Directory search failed', [
                'account' => $account->email,
                'reason' => $e->getMessage(),
            ]);

            return response()->json([
                'people' => [],
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Free/busy intervals for a set of people (invitee availability preview).
     */
    public function freeBusy(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'emails' => ['required', 'array', 'max:50'],
            'emails.*' => ['email'],
            'start' => ['required', 'date'],
            'end' => ['required', 'date', 'after:start'],
        ]);

        $account = $request->user()->googleAccounts()->first();

        abort_if($account === null, 422, 'Connect a Google account first.');

        $busy = (new GoogleCalendarClient($account))->freeBusy(
            $validated['emails'],
            Carbon::parse($validated['start']),
            Carbon::parse($validated['end']),
        );

        return response()->json(['busy' => $busy]);
    }

    /**
     * Overlay a colleague's calendar: full event details when their calendar
     * is shared with the user, otherwise free/busy busy-blocks.
     */
    public function overlay(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'start' => ['required', 'date'],
            'end' => ['required', 'date', 'after:start'],
        ]);

        $account = $request->user()->googleAccounts()->first();

        abort_if($account === null, 422, 'Connect a Google account first.');

        $client = new GoogleCalendarClient($account);
        $start = Carbon::parse($validated['start']);
        $end = Carbon::parse($validated['end']);

        try {
            $items = $client->listEvents($validated['email'], $start, $end);

            $events = [];

            foreach ($items as $item) {
                if (($item['status'] ?? '') === 'cancelled') {
                    continue;
                }

                $events[] = $this->mapEvent($item);
            }

            return response()->json(['shared' => true, 'events' => $events]);
        } catch (RequestException) {
            // No access to full details — degrade to free/busy busy-blocks.
            $busy = $client->freeBusy([$validated['email']], $start, $end);

            return response()->json([
                'shared' => false,
                'busy' => $busy[$validated['email']] ?? [],
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    protected function validateEvent(Request $request, bool $creating): array
    {
        return $request->validate([
            'calendar_id' => ['required', 'string'],
            'event_id' => [$creating ? 'prohibited' : 'required', 'string'],
            'summary' => ['required', 'string', 'max:1024'],
            'description' => ['nullable', 'string'],
            'location' => ['nullable', 'string'],
            'all_day' => ['required', 'boolean'],
            'start' => ['required', 'string'],
            'end' => ['required', 'string'],
            'attendees' => ['array'],
            'attendees.*' => ['email'],
        ]);
    }

    /**
     * Turn validated input into a Google event resource body.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    protected function buildBody(array $data): array
    {
        $timeKey = $data['all_day'] ? 'date' : 'dateTime';

        $body = [
            'summary' => $data['summary'],
            'description' => $data['description'] ?? null,
            'location' => $data['location'] ?? null,
            'start' => [$timeKey => $data['start']],
            'end' => [$timeKey => $data['end']],
        ];

        if (! empty($data['attendees'])) {
            $body['attendees'] = array_map(
                fn (string $email): array => ['email' => $email],
                $data['attendees'],
            );
        }

        return $body;
    }

    /**
     * Normalize a Google event for the client.
     *
     * @param  array<string, mixed>  $item
     * @return array<string, mixed>
     */
    protected function mapEvent(array $item): array
    {
        $allDay = isset($item['start']['date']);

        return [
            'id' => $item['id'] ?? null,
            'summary' => $item['summary'] ?? '(no title)',
            'description' => $item['description'] ?? null,
            'location' => $item['location'] ?? null,
            'html_link' => $item['htmlLink'] ?? null,
            'hangout_link' => $item['hangoutLink'] ?? null,
            'all_day' => $allDay,
            'start' => $allDay ? ($item['start']['date'] ?? null) : ($item['start']['dateTime'] ?? null),
            'end' => $allDay ? ($item['end']['date'] ?? null) : ($item['end']['dateTime'] ?? null),
            'attendees' => array_map(
                fn (array $attendee): array => [
                    'email' => $attendee['email'] ?? '',
                    'response' => $attendee['responseStatus'] ?? 'needsAction',
                ],
                is_array($item['attendees'] ?? null) ? $item['attendees'] : [],
            ),
        ];
    }

    protected function accountForCalendar(User $user, string $calendarId): ?GoogleAccount
    {
        return $user->googleAccounts()
            ->get()
            ->first(fn (GoogleAccount $account): bool => collect($account->calendars ?? [])
                ->contains(fn (array $calendar): bool => ($calendar['id'] ?? null) === $calendarId));
    }
}
