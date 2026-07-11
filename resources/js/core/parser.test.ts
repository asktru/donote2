import { describe, expect, it } from 'vitest';

import {
    childrenOf,
    extractWikiLinks,
    parseLine,
    parseNote,
    parseRepeatRule,
    tasksOf,
} from './parser';

describe('parseLine — kinds and states', () => {
    it('parses open tasks with - and * markers', () => {
        expect(parseLine('- [ ] Write report').kind).toBe('task');
        expect(parseLine('* [ ] Write report').kind).toBe('task');
        expect(parseLine('- [ ] Write report').state).toBe('open');
    });

    it('parses done, cancelled and scheduled states', () => {
        expect(parseLine('- [x] Done thing').state).toBe('done');
        expect(parseLine('- [X] Done thing').state).toBe('done');
        expect(parseLine('- [-] Nope').state).toBe('cancelled');
        expect(parseLine('- [>] Moved').state).toBe('scheduled');
    });

    it('distinguishes checklists from tasks', () => {
        const checklist = parseLine('+ [ ] Pack charger');
        expect(checklist.kind).toBe('checklist');
        expect(checklist.state).toBe('open');
        expect(checklist.title).toBe('Pack charger');
    });

    it('parses bullets, headings, text and empty lines', () => {
        expect(parseLine('- just a bullet').kind).toBe('bullet');
        expect(parseLine('+ plus bullet').kind).toBe('bullet');
        expect(parseLine('## Section').kind).toBe('heading');
        expect(parseLine('## Section').headingLevel).toBe(2);
        expect(parseLine('plain words').kind).toBe('text');
        expect(parseLine('   ').kind).toBe('empty');
    });

    it('computes indentation with tabs as 4', () => {
        expect(parseLine('    - [ ] indented').indent).toBe(4);
        expect(parseLine('\t- [ ] tabbed').indent).toBe(4);
    });
});

describe('parseLine — priorities', () => {
    it('extracts !!! / !! / ! prefixes', () => {
        expect(parseLine('- [ ] !!! Ship the release').priority).toBe(3);
        expect(parseLine('- [ ] !! Ship the release').priority).toBe(2);
        expect(parseLine('- [ ] ! Ship the release').priority).toBe(1);
        expect(parseLine('- [ ] Ship the release').priority).toBe(0);
        expect(parseLine('- [ ] !! Ship the release').title).toBe(
            'Ship the release',
        );
    });

    it('does not treat mid-title exclamations as priority', () => {
        expect(parseLine('- [ ] Ship it! now').priority).toBe(0);
    });
});

describe('parseLine — scheduling', () => {
    it('parses schedule tokens of every granularity', () => {
        expect(parseLine('- [ ] Task >2026-07-15').schedule).toBe('2026-07-15');
        expect(parseLine('- [ ] Task >2026-W30').schedule).toBe('2026-W30');
        expect(parseLine('- [ ] Task >2026-09').schedule).toBe('2026-09');
        expect(parseLine('- [ ] Task >2026-Q4').schedule).toBe('2026-Q4');
        expect(parseLine('- [ ] Task >2026').schedule).toBe('2026');
    });

    it('strips schedule tokens from the title', () => {
        expect(
            parseLine('- [ ] Review budget >2026-Q4 with finance').title,
        ).toBe('Review budget with finance');
    });

    it('parses @due dates', () => {
        const line = parseLine(
            '- [ ] Submit filing >2026-07-10 @due(2026-07-20)',
        );
        expect(line.schedule).toBe('2026-07-10');
        expect(line.due).toBe('2026-07-20');
        expect(line.title).toBe('Submit filing');
    });
});

describe('parseLine — reminders', () => {
    it('parses am/pm and 24h reminders', () => {
        expect(parseLine('- [ ] Standup @8am').reminderMinutes).toBe(8 * 60);
        expect(parseLine('- [ ] Lunch @12pm').reminderMinutes).toBe(12 * 60);
        expect(parseLine('- [ ] Midnight review @12am').reminderMinutes).toBe(
            0,
        );
        expect(parseLine('- [ ] Call @8:15pm').reminderMinutes).toBe(
            20 * 60 + 15,
        );
        expect(parseLine('- [ ] Sync @14:30').reminderMinutes).toBe(
            14 * 60 + 30,
        );
    });

    it('ignores invalid or ambiguous times', () => {
        expect(parseLine('- [ ] Weird @25:00').reminderMinutes).toBeNull();
        expect(parseLine('- [ ] Bare @8').reminderMinutes).toBeNull();
        expect(parseLine('- [ ] @13pm impossible').reminderMinutes).toBeNull();
    });

    it('strips the reminder from the title', () => {
        expect(parseLine('- [ ] Standup @8am with team').title).toBe(
            'Standup with team',
        );
    });
});

describe('parseLine — repeat rules', () => {
    it('parses interval rules', () => {
        expect(parseRepeatRule('3d')).toEqual({
            kind: 'interval',
            amount: 3,
            unit: 'd',
            fromCompletion: false,
            raw: '3d',
        });
        expect(parseRepeatRule('1w')).toMatchObject({
            kind: 'interval',
            amount: 1,
            unit: 'w',
        });
        expect(parseRepeatRule('2m')).toMatchObject({
            kind: 'interval',
            unit: 'm',
        });
        expect(parseRepeatRule('1y')).toMatchObject({
            kind: 'interval',
            unit: 'y',
        });
    });

    it('parses from-completion rules', () => {
        expect(parseRepeatRule('+3d')).toMatchObject({
            kind: 'interval',
            amount: 3,
            fromCompletion: true,
        });
    });

    it('parses weekday rules', () => {
        expect(parseRepeatRule('Tue,Thu')).toEqual({
            kind: 'weekdays',
            weekdays: [2, 4],
            raw: 'Tue,Thu',
        });
        expect(parseRepeatRule('Mon, Wed, Fri')).toMatchObject({
            weekdays: [1, 3, 5],
        });
    });

    it('parses month-day rules', () => {
        expect(parseRepeatRule('20th')).toEqual({
            kind: 'monthday',
            day: 20,
            raw: '20th',
        });
        expect(parseRepeatRule('1st')).toMatchObject({ day: 1 });
        expect(parseRepeatRule('3rd')).toMatchObject({ day: 3 });
    });

    it('rejects garbage', () => {
        expect(parseRepeatRule('whenever')).toBeNull();
        expect(parseRepeatRule('40th')).toBeNull();
    });

    it('attaches repeat rules to tasks', () => {
        const line = parseLine('- [ ] Water plants >2026-07-11 @repeat(3d)');
        expect(line.repeat).toMatchObject({ kind: 'interval', amount: 3 });
        expect(line.title).toBe('Water plants');
    });
});

describe('parseLine — tags, mentions, wiki links', () => {
    it('extracts hashtags', () => {
        const line = parseLine('- [ ] Prep deck #work #q3/planning');
        expect(line.tags).toEqual(['work', 'q3/planning']);
    });

    it('extracts mentions but not metadata tokens', () => {
        const line = parseLine(
            '- [ ] Review PR @sarah @due(2026-07-20) @repeat(Tue,Thu) @8am',
        );
        expect(line.mentions).toEqual(['sarah']);
    });

    it('extracts nested mentions with slashes', () => {
        const line = parseLine('- [ ] Sync with @team/design and @team/eng');
        expect(line.mentions).toEqual(['team/design', 'team/eng']);
    });

    it('does not extract emails as mentions or anchors as tags', () => {
        const line = parseLine('- [ ] Email jane@corp.com about C# stuff');
        expect(line.mentions).toEqual([]);
    });

    it('extracts wiki links with optional display text', () => {
        const links = extractWikiLinks(
            'See [[Project Alpha]] and [[Roadmap 2026 | the roadmap]].',
        );
        expect(links).toHaveLength(2);
        expect(links[0]).toMatchObject({
            target: 'Project Alpha',
            display: 'Project Alpha',
        });
        expect(links[1]).toMatchObject({
            target: 'Roadmap 2026',
            display: 'the roadmap',
        });
    });

    it('records wiki link offsets', () => {
        const [link] = extractWikiLinks('ab [[C]] d');
        expect(link.from).toBe(3);
        expect(link.to).toBe(8);
    });
});

describe('parseNote — hierarchy', () => {
    const note = [
        '# Today',
        '- [ ] Parent task',
        '    - [ ] Subtask one',
        '        - some detail',
        '    + [ ] Sub checklist',
        '- [ ] Second task',
        '',
        'Free paragraph',
    ].join('\n');

    it('links indented lines to their parent task', () => {
        const lines = parseNote(note);
        expect(lines[2].parent).toBe(1);
        expect(lines[3].parent).toBe(2);
        expect(lines[4].parent).toBe(1);
        expect(lines[5].parent).toBeNull();
    });

    it('collects transitive children', () => {
        const lines = parseNote(note);
        const children = childrenOf(lines, 1);
        expect(children.map((line) => line.index)).toEqual([2, 3, 4]);
    });

    it('filters tasks and optionally checklists', () => {
        const lines = parseNote(note);
        expect(tasksOf(lines)).toHaveLength(3);
        expect(tasksOf(lines, true)).toHaveLength(4);
    });

    it('headings reset nesting', () => {
        const lines = parseNote(
            '- [ ] Task\n# Heading\n    - [ ] Indented after heading',
        );
        expect(lines[2].parent).toBeNull();
    });
});
