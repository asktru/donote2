import { describe, expect, it } from 'vitest';

import {
    buildAgendaAppendix,
    classifyPerson,
    extractActionItems,
    parseAgendaConfig,
    selectMeetings
    
    
} from './agenda';
import type {AgendaConfig, AgendaMeeting} from './agenda';

const AGENDA_FM = [
    '---',
    'agenda: Ivan',
    'me: Антон Скляр, Антон Скліар, Anton Skliar',
    'others: Іван : @IvanYakubyshyn',
    'range: 7',
    '---',
    '',
].join('\n');

const MEETING = (title: string, date: string): AgendaMeeting => ({
    title,
    folder: 'Meetings',
    updatedAt: `${date}T10:00:00Z`,
    content: [
        `---`,
        `meeting-date: ${date}`,
        `source: bluedot`,
        `---`,
        `## Overview`,
        `- recap`,
        ``,
        `## Action Items`,
        ``,
        `### Іван Якубишин`,
        `- Ship the compliance draft`,
        ``,
        `### Антон Скліар`,
        `- Review internet providers`,
        `- Plan the VPN setup`,
        ``,
        `### Random Guest`,
        `- Send the deck`,
        ``,
        `## Topics`,
        `### A topic`,
        `- detail`,
    ].join('\n'),
});

describe('parseAgendaConfig', () => {
    it('parses agenda/me/others/range', () => {
        const config = parseAgendaConfig(AGENDA_FM);
        expect(config).not.toBeNull();
        expect(config!.agenda).toBe('Ivan');
        expect(config!.me).toEqual(['Антон Скляр', 'Антон Скліар', 'Anton Skliar']);
        expect(config!.others).toEqual([{ substring: 'Іван', mention: '@IvanYakubyshyn' }]);
        expect(config!.days).toBe(7);
    });

    it('returns null without an agenda key, and defaults range to 7', () => {
        expect(parseAgendaConfig('---\ntype: area\n---\n')).toBeNull();
        expect(parseAgendaConfig('---\nagenda: X\n---\n')!.days).toBe(7);
    });
});

describe('extractActionItems', () => {
    it('groups items by person heading within the Action Items section only', () => {
        const groups = extractActionItems(MEETING('Ivan <> Anton -- 2026-04-21', '2026-04-21').content);
        expect(groups.map((g) => g.person)).toEqual([
            'Іван Якубишин',
            'Антон Скліар',
            'Random Guest',
        ]);
        expect(groups[1].items).toEqual(['Review internet providers', 'Plan the VPN setup']);
        // Topic bullets are not action items.
        expect(groups.every((g) => !g.items.includes('detail'))).toBe(true);
    });
});

describe('classifyPerson', () => {
    const config = parseAgendaConfig(AGENDA_FM) as AgendaConfig;

    it('routes me / others / unknown', () => {
        expect(classifyPerson('Антон Скліар', config).kind).toBe('me');
        expect(classifyPerson('Іван Якубишин', config)).toEqual({ kind: 'other', mention: '@IvanYakubyshyn' });
        expect(classifyPerson('Random Guest', config).kind).toBe('unknown');
    });
});

describe('selectMeetings', () => {
    const config = parseAgendaConfig(AGENDA_FM) as AgendaConfig;

    it('filters by folder, title substring, date range, and dedup', () => {
        const meetings = [
            MEETING('Ivan <> Anton -- 2026-04-21', '2026-04-21'),
            MEETING('Natalie <> Anton -- 2026-04-20', '2026-04-20'), // wrong title
            MEETING('Ivan <> Anton -- 2026-04-01', '2026-04-01'), // out of range
            { ...MEETING('Ivan <> Anton -- 2026-04-19', '2026-04-19'), folder: 'Projects' }, // wrong folder
        ];
        const selected = selectMeetings(meetings, config, '', '2026-04-22');
        expect(selected.map((s) => s.meeting.title)).toEqual(['Ivan <> Anton -- 2026-04-21']);
    });

    it('skips meetings already linked in the agenda note', () => {
        const meetings = [MEETING('Ivan <> Anton -- 2026-04-21', '2026-04-21')];
        const agenda = `${AGENDA_FM}\n- [[Ivan <> Anton -- 2026-04-21 | 2026-04-21]]`;
        expect(selectMeetings(meetings, config, agenda, '2026-04-22')).toHaveLength(0);
    });
});

describe('buildAgendaAppendix', () => {
    it('formats meeting wiki-link, my tasks, others checklist+mention, unknown checklist', () => {
        const meetings = [MEETING('Ivan <> Anton -- 2026-04-21', '2026-04-21')];
        const { appendix, count } = buildAgendaAppendix(AGENDA_FM, meetings, '2026-04-22');

        expect(count).toBe(1);
        expect(appendix).toBe(
            [
                '- [[Ivan <> Anton -- 2026-04-21 | 2026-04-21]]',
                '    - Іван Якубишин',
                '        + [ ] Ship the compliance draft @IvanYakubyshyn',
                '    - Антон Скліар',
                '        - [ ] Review internet providers',
                '        - [ ] Plan the VPN setup',
                '    - Random Guest',
                '        + [ ] Send the deck',
            ].join('\n'),
        );
    });

    it('is empty when nothing matches', () => {
        expect(buildAgendaAppendix(AGENDA_FM, [], '2026-04-22').count).toBe(0);
        expect(buildAgendaAppendix('---\ntype: area\n---\n', [], '2026-04-22').appendix).toBe('');
    });
});
