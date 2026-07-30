<?php

namespace App\Services;

use App\Models\GoogleAccount;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Read/write wrapper around the Google Calendar v3 API for one account. The
 * account's token is refreshed on construction; all calls carry it.
 */
class GoogleCalendarClient
{
    private const BASE = 'https://www.googleapis.com/calendar/v3';

    public function __construct(private readonly GoogleAccount $account)
    {
        $account->ensureFreshToken();
    }

    private function http(): PendingRequest
    {
        return Http::withToken($this->account->access_token);
    }

    /**
     * Search the Workspace directory for people (Meet-with autocomplete).
     * Requires the directory.readonly scope and the People API enabled on
     * the Google Cloud project.
     *
     * @return list<array{name: string, email: string}>
     *
     * @throws \RuntimeException when Google rejects the request (surfaces the
     *                           real reason, e.g. People API disabled)
     */
    public function searchDirectory(string $query, int $limit = 8): array
    {
        $response = $this->http()->get(
            'https://people.googleapis.com/v1/people:searchDirectoryPeople',
            [
                'query' => $query,
                'readMask' => 'names,emailAddresses',
                'sources' => 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE',
                'pageSize' => $limit,
            ],
        );

        if ($response->failed()) {
            throw new \RuntimeException(
                $response->json('error.message')
                    ?? 'Directory search failed ('.$response->status().').',
            );
        }

        $people = [];

        foreach ($response->json('people', []) as $person) {
            $email = $person['emailAddresses'][0]['value'] ?? null;

            if ($email === null) {
                continue;
            }

            $people[] = [
                'name' => $person['names'][0]['displayName'] ?? $email,
                'email' => $email,
            ];
        }

        return $people;
    }

    /**
     * Create an event; attaches a Google Meet link when $withMeet.
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function insertEvent(string $calendarId, array $body, bool $withMeet): array
    {
        if ($withMeet) {
            $body['conferenceData'] = [
                'createRequest' => [
                    'requestId' => (string) Str::uuid(),
                    'conferenceSolutionKey' => ['type' => 'hangoutsMeet'],
                ],
            ];
        }

        return $this->http()
            ->post(
                self::BASE.'/calendars/'.urlencode($calendarId).'/events?conferenceDataVersion=1&sendUpdates=all',
                $body,
            )
            ->throw()
            ->json();
    }

    /**
     * Patch an existing event.
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function patchEvent(string $calendarId, string $eventId, array $body): array
    {
        return $this->http()
            ->patch(
                self::BASE.'/calendars/'.urlencode($calendarId).'/events/'.urlencode($eventId).'?conferenceDataVersion=1&sendUpdates=all',
                $body,
            )
            ->throw()
            ->json();
    }

    /**
     * Read a single event.
     *
     * @return array<string, mixed>
     */
    public function getEvent(string $calendarId, string $eventId): array
    {
        return $this->http()
            ->get(self::BASE.'/calendars/'.urlencode($calendarId).'/events/'.urlencode($eventId))
            ->throw()
            ->json();
    }

    /**
     * Answer an invitation as the current user.
     *
     * Google replaces the attendee list on patch rather than merging it, so
     * the answer has to be a read-then-write: fetch the event, swap the
     * `self` attendee's status, send the whole list back.
     *
     * With $wholeSeries the answer is written to the recurring master, which
     * applies it to every occurrence. A one-off event has no master, so the
     * instance itself is the only copy there is to answer.
     *
     * @return array<string, mixed>
     *
     * @throws \RuntimeException when the user is not on the guest list
     */
    public function respondToEvent(
        string $calendarId,
        string $eventId,
        string $response,
        bool $wholeSeries,
    ): array {
        $event = $this->getEvent($calendarId, $eventId);

        if ($wholeSeries && ! empty($event['recurringEventId'])) {
            $eventId = (string) $event['recurringEventId'];
            $event = $this->getEvent($calendarId, $eventId);
        }

        $attendees = is_array($event['attendees'] ?? null) ? $event['attendees'] : [];
        $answered = false;

        foreach ($attendees as $index => $attendee) {
            if (($attendee['self'] ?? false) === true) {
                $attendees[$index]['responseStatus'] = $response;
                $answered = true;
            }
        }

        if (! $answered) {
            throw new \RuntimeException("You're not an invitee on this event.");
        }

        return $this->patchEvent($calendarId, $eventId, ['attendees' => $attendees]);
    }

    public function deleteEvent(string $calendarId, string $eventId): void
    {
        $this->http()
            ->delete(self::BASE.'/calendars/'.urlencode($calendarId).'/events/'.urlencode($eventId).'?sendUpdates=all')
            ->throw();
    }

    /**
     * List a calendar's events in a range. Throws on no-access (used to
     * detect when to fall back to free/busy for a colleague's calendar).
     *
     * @return array<int, array<string, mixed>>
     */
    public function listEvents(string $calendarId, Carbon $start, Carbon $end): array
    {
        return $this->http()
            ->get(self::BASE.'/calendars/'.urlencode($calendarId).'/events', [
                'timeMin' => $start->toRfc3339String(),
                'timeMax' => $end->toRfc3339String(),
                'singleEvents' => 'true',
                'orderBy' => 'startTime',
                'maxResults' => 250,
            ])
            ->throw()
            ->json('items', []);
    }

    /**
     * Query free/busy intervals for a set of calendar ids (emails).
     *
     * @param  array<int, string>  $ids
     * @return array<string, array<int, array{start: string, end: string}>> id => busy intervals
     */
    public function freeBusy(array $ids, Carbon $start, Carbon $end): array
    {
        $response = $this->http()
            ->post(self::BASE.'/freeBusy', [
                'timeMin' => $start->toRfc3339String(),
                'timeMax' => $end->toRfc3339String(),
                'items' => array_map(fn (string $id): array => ['id' => $id], $ids),
            ])
            ->throw()
            ->json('calendars', []);

        $busy = [];

        foreach (is_array($response) ? $response : [] as $id => $data) {
            $busy[$id] = array_map(
                fn (array $slot): array => ['start' => $slot['start'], 'end' => $slot['end']],
                is_array($data['busy'] ?? null) ? $data['busy'] : [],
            );
        }

        return $busy;
    }
}
