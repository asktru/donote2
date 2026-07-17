<?php

namespace App\Actions\Google;

use App\Models\GoogleAccount;
use App\Models\User;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class FetchGoogleEvents
{
    /**
     * Google's fixed per-event palette (event.colorId 1–11), in the modern
     * hues the Calendar UI itself renders. Events without a custom color
     * carry no colorId and fall back to their calendar's color. (The API
     * sends colorId as a string; PHP coerces the numeric keys to ints, and
     * numeric-string lookups coerce the same way.)
     *
     * @var array<int, string>
     */
    public const EVENT_COLORS = [
        '1' => '#7986CB',  // Lavender
        '2' => '#33B679',  // Sage
        '3' => '#8E24AA',  // Grape
        '4' => '#E67C73',  // Flamingo
        '5' => '#F6BF26',  // Banana
        '6' => '#F4511E',  // Tangerine
        '7' => '#039BE5',  // Peacock
        '8' => '#616161',  // Graphite
        '9' => '#3F51B5',  // Blueberry
        '10' => '#0B8043', // Basil
        '11' => '#D50000', // Tomato
    ];

    /**
     * Fetch events for the given range across all of the user's Google accounts.
     *
     * @return array<int, array<string, mixed>>
     */
    public function execute(User $user, Carbon $start, Carbon $end): array
    {
        $cacheKey = sprintf('google-events:%d:%s:%s', $user->id, $start->toDateString(), $end->toDateString());

        return Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user, $start, $end): array {
            return $user->googleAccounts()
                ->get()
                ->flatMap(fn (GoogleAccount $account) => $this->eventsForAccount($account, $start, $end))
                ->sortBy('start')
                ->values()
                ->all();
        });
    }

    /**
     * Fetch events from every selected calendar of one account.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function eventsForAccount(GoogleAccount $account, Carbon $start, Carbon $end): array
    {
        $account->ensureFreshToken();

        $calendars = collect($account->calendars ?? [])
            ->filter(fn (array $calendar): bool => $calendar['selected'] ?? false);

        return $calendars
            ->flatMap(function (array $calendar) use ($account, $start, $end): array {
                try {
                    $items = Http::withToken($account->access_token)
                        ->get(
                            'https://www.googleapis.com/calendar/v3/calendars/'.urlencode((string) $calendar['id']).'/events',
                            [
                                'timeMin' => $start->toRfc3339String(),
                                'timeMax' => $end->toRfc3339String(),
                                'singleEvents' => 'true',
                                'orderBy' => 'startTime',
                                'maxResults' => 100,
                            ],
                        )
                        ->throw()
                        ->json('items', []);
                } catch (RequestException) {
                    return [];
                }

                $events = [];

                foreach (is_array($items) ? $items : [] as $item) {
                    if (! is_array($item) || ($item['status'] ?? '') === 'cancelled') {
                        continue;
                    }

                    $events[] = $this->mapEvent($item, $account, $calendar);
                }

                return $events;
            })
            ->all();
    }

    /**
     * Normalize a Google event payload for the client.
     *
     * @param  array<string, mixed>  $item
     * @param  array<string, mixed>  $calendar
     * @return array<string, mixed>
     */
    protected function mapEvent(array $item, GoogleAccount $account, array $calendar): array
    {
        $allDay = isset($item['start']['date']);
        $attendees = is_array($item['attendees'] ?? null) ? $item['attendees'] : [];
        $self = collect($attendees)->first(fn (array $a): bool => ($a['self'] ?? false) === true);

        return [
            'id' => $item['id'],
            'calendar_id' => $calendar['id'],
            'calendar_name' => $calendar['summary'],
            'account_email' => $account->email,
            'summary' => $item['summary'] ?? '(no title)',
            'description' => $item['description'] ?? null,
            'location' => $item['location'] ?? null,
            'html_link' => $item['htmlLink'] ?? null,
            'hangout_link' => $item['hangoutLink'] ?? null,
            'color' => $calendar['color'] ?? null,
            'event_color' => self::EVENT_COLORS[$item['colorId'] ?? ''] ?? null,
            'all_day' => $allDay,
            'start' => $allDay ? $item['start']['date'] : ($item['start']['dateTime'] ?? null),
            'end' => $allDay ? $item['end']['date'] : ($item['end']['dateTime'] ?? null),
            // Identifies a repeating series (for "hide all occurrences").
            'recurring_event_id' => $item['recurringEventId'] ?? null,
            // The current user's RSVP; personal/own events have no attendees.
            'response_status' => $self['responseStatus'] ?? 'accepted',
            'attendees' => array_map(fn (array $a): array => [
                'email' => $a['email'] ?? '',
                'name' => $a['displayName'] ?? null,
                'response' => $a['responseStatus'] ?? 'needsAction',
                'organizer' => $a['organizer'] ?? false,
                'self' => $a['self'] ?? false,
            ], $attendees),
        ];
    }
}
