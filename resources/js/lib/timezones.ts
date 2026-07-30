/**
 * Choosing a secondary time axis. IANA ids are how the platform names zones
 * but not how anyone thinks about them — "kiev" should find `Europe/Kiev` —
 * and what the user is really picking is an offset, so show that too.
 */

/** The city an IANA id names: `Europe/Kiev` → `Kiev`. */
export function zoneCity(zone: string): string {
    return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** A zone's current offset from UTC, e.g. `UTC+3`, `UTC−3:30`. */
export function zoneOffsetLabel(zone: string, at: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name =
        parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);

    if (!match) {
        return 'UTC+0';
    }

    const [, sign, hours, minutes] = match;

    return `UTC${sign === '-' ? '−' : '+'}${Number(hours)}${
        Number(minutes) > 0 ? `:${minutes}` : ''
    }`;
}

/**
 * Zones matching a query, city matches first. Underscores in an id are
 * treated as spaces, so "new york" and "new_york" both work.
 */
export function searchZones(
    zones: string[],
    query: string,
    limit = 200,
): string[] {
    const needle = query.trim().toLowerCase().replace(/_/g, ' ');

    if (needle === '') {
        return zones.slice(0, limit);
    }

    const scored: { zone: string; score: number }[] = [];

    for (const zone of zones) {
        const city = zoneCity(zone).toLowerCase();
        const full = zone.toLowerCase().replace(/_/g, ' ');
        const score = city.startsWith(needle)
            ? 0
            : city.includes(needle)
              ? 1
              : full.includes(needle)
                ? 2
                : -1;

        if (score !== -1) {
            scored.push({ zone, score });
        }
    }

    return scored
        .sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone))
        .slice(0, limit)
        .map((entry) => entry.zone);
}
