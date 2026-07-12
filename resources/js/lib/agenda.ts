import { parseNoteMeta } from '@/core/frontmatter';

/**
 * "Fetch agenda" bubbles action items from recent meeting notes into an
 * agenda note. It is driven entirely by the agenda note's front matter:
 *
 *   agenda: Anastasiia            # substring to find in meeting titles
 *   me: Антон Скляр, Anton Skliar # names that represent me
 *   others: Анастасія : @AnastasiiaBoiko
 *   range: 7                      # days back to scan (optional, default 7)
 *
 * Meetings are matched from the "Meetings" folder by title substring within
 * the date range. Each meeting's `## Action Items` section is split by its
 * `### Person` sub-headings; my items become tasks, everyone else's become
 * checklist items (with a mention when the person is listed in `others`).
 */
export interface AgendaConfig {
    agenda: string;
    me: string[];
    others: { substring: string; mention: string }[];
    days: number;
}

export interface AgendaMeeting {
    title: string;
    folder: string;
    content: string;
    updatedAt: string;
}

/** Parse the agenda front matter, or null when it isn't an agenda note. */
export function parseAgendaConfig(content: string): AgendaConfig | null {
    const props = parseNoteMeta(content).properties;
    const agenda = (props.agenda ?? '').trim();

    if (agenda === '') {
        return null;
    }

    const me = splitList(props.me);
    const others = splitList(props.others)
        .map((entry) => {
            const [substring, mention] = entry.split(':').map((s) => s.trim());

            return { substring, mention: mention ?? '' };
        })
        .filter((o) => o.substring !== '');

    const days = Number.parseInt((props.range ?? props.days ?? '').trim(), 10);

    return {
        agenda,
        me,
        others,
        days: Number.isFinite(days) && days > 0 ? days : 7,
    };
}

function splitList(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
}

const TITLE_DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const FM_DATE_RE = /^meeting-date:\s*(\d{4}-\d{2}-\d{2})/m;

/** The meeting's date: front matter first, else a date in the title. */
export function meetingDate(meeting: AgendaMeeting): string | null {
    return (
        meeting.content.match(FM_DATE_RE)?.[1] ??
        meeting.title.match(TITLE_DATE_RE)?.[1] ??
        null
    );
}

/**
 * Meetings to pull in: in the Meetings folder, title contains the agenda
 * substring, dated within range, and not already linked in the agenda note.
 * Oldest first, matching how meetings accrete down the note.
 */
export function selectMeetings(
    meetings: AgendaMeeting[],
    config: AgendaConfig,
    agendaContent: string,
    today: string,
): { meeting: AgendaMeeting; date: string }[] {
    const needle = config.agenda.toLowerCase();
    const cutoff = addDays(today, -config.days);

    return meetings
        .filter((m) => m.folder === 'Meetings' || m.folder.startsWith('Meetings/'))
        .filter((m) => m.title.toLowerCase().includes(needle))
        .map((meeting) => ({ meeting, date: meetingDate(meeting) }))
        .filter(
            (row): row is { meeting: AgendaMeeting; date: string } =>
                row.date !== null && row.date >= cutoff && row.date <= today,
        )
        .filter(({ meeting }) => !agendaContent.includes(`[[${meeting.title}`))
        .sort((a, b) => a.date.localeCompare(b.date));
}

const PERSON_HEADING_RE = /^#{2,4}\s+(.+?)\s*$/;
const ITEM_RE = /^\s*(?:[-*+]\s+(?:\[[ xX>-]\]\s+)?)(.+?)\s*$/;

/** Action items in a meeting note, grouped by their `### Person` heading. */
export function extractActionItems(
    content: string,
): { person: string; items: string[] }[] {
    const lines = content.split('\n');
    const groups: { person: string; items: string[] }[] = [];
    let inSection = false;
    let current: { person: string; items: string[] } | null = null;

    for (const line of lines) {
        const h2 = /^##(?!#)\s+(.+?)\s*$/.exec(line);

        if (h2) {
            inSection = /^action items$/i.test(h2[1].trim());
            current = null;

            continue;
        }

        if (!inSection) {
            continue;
        }

        const heading = PERSON_HEADING_RE.exec(line);

        if (heading) {
            current = { person: heading[1].trim(), items: [] };
            groups.push(current);

            continue;
        }

        const item = ITEM_RE.exec(line);

        if (item && current) {
            current.items.push(item[1].trim());
        }
    }

    return groups.filter((g) => g.items.length > 0);
}

/** How a meeting person maps to the agenda owner's roster. */
export function classifyPerson(
    person: string,
    config: AgendaConfig,
): { kind: 'me' | 'other' | 'unknown'; mention: string } {
    const lower = person.toLowerCase();

    if (config.me.some((name) => lower.includes(name.toLowerCase()))) {
        return { kind: 'me', mention: '' };
    }

    const other = config.others.find((o) =>
        lower.includes(o.substring.toLowerCase()),
    );

    if (other) {
        return { kind: 'other', mention: other.mention };
    }

    return { kind: 'unknown', mention: '' };
}

/**
 * The markdown block to append for one meeting, or '' if it has no action
 * items. Mirrors the reference agenda layout: a wiki-link, then per-person
 * sub-bullets with tasks (me) or checklist items (others).
 */
export function buildMeetingBlock(
    meeting: AgendaMeeting,
    date: string,
    config: AgendaConfig,
): string {
    const groups = extractActionItems(meeting.content);

    if (groups.length === 0) {
        return '';
    }

    const lines: string[] = [`- [[${meeting.title} | ${date}]]`];

    for (const { person, items } of groups) {
        const { kind, mention } = classifyPerson(person, config);
        lines.push(`    - ${person}`);

        for (const item of items) {
            if (kind === 'me') {
                lines.push(`        - [ ] ${item}`);
            } else if (kind === 'other' && mention !== '') {
                lines.push(`        + [ ] ${item} ${mention}`);
            } else {
                lines.push(`        + [ ] ${item}`);
            }
        }
    }

    return lines.join('\n');
}

/** The full text to append to the agenda note (empty if nothing new). */
export function buildAgendaAppendix(
    agendaContent: string,
    meetings: AgendaMeeting[],
    today: string,
): { appendix: string; count: number } {
    const config = parseAgendaConfig(agendaContent);

    if (config === null) {
        return { appendix: '', count: 0 };
    }

    const blocks = selectMeetings(meetings, config, agendaContent, today)
        .map(({ meeting, date }) => buildMeetingBlock(meeting, date, config))
        .filter((block) => block !== '');

    return { appendix: blocks.join('\n'), count: blocks.length };
}

/** Shift an ISO date (yyyy-mm-dd) by whole days, staying in ISO. */
function addDays(iso: string, delta: number): string {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);

    return date.toISOString().slice(0, 10);
}
