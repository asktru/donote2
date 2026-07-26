import { describe, expect, it } from 'vitest';

import { parseNote } from './parser';
import { applyTitleRenames, retargetWikiLinks } from './wikiLinks';

describe('retargetWikiLinks', () => {
    it('repoints a plain link at the new title', () => {
        expect(
            retargetWikiLinks(
                'See [[Booster]] for context.',
                'Booster',
                'Rocket',
            ),
        ).toBe('See [[Rocket]] for context.');
    });

    it('keeps a named link’s label, and its spacing', () => {
        expect(
            retargetWikiLinks('[[Booster|the plan]]', 'Booster', 'Rocket'),
        ).toBe('[[Rocket|the plan]]');
        expect(
            retargetWikiLinks('[[Booster | the plan]]', 'Booster', 'Rocket'),
        ).toBe('[[Rocket | the plan]]');
    });

    it('matches titles the way links resolve — trimmed, any case', () => {
        expect(retargetWikiLinks('[[ booster ]]', 'Booster', 'Rocket')).toBe(
            '[[Rocket]]',
        );
        expect(retargetWikiLinks('[[BOOSTER|x]]', 'booster', 'Rocket')).toBe(
            '[[Rocket|x]]',
        );
    });

    it('rewrites every link, on every line', () => {
        const content = [
            '- [ ] Ask about [[Booster]] and [[Booster|the other thing]]',
            'Unrelated [[Engine]] link',
            '[[Booster]]',
        ].join('\n');

        expect(retargetWikiLinks(content, 'Booster', 'Rocket')).toBe(
            [
                '- [ ] Ask about [[Rocket]] and [[Rocket|the other thing]]',
                'Unrelated [[Engine]] link',
                '[[Rocket]]',
            ].join('\n'),
        );
    });

    it('leaves links to other notes alone', () => {
        const content = '[[Engine]] [[Boosters]] [[Booster room]]';

        expect(retargetWikiLinks(content, 'Booster', 'Rocket')).toBe(content);
    });

    it('leaves text that merely mentions the title alone', () => {
        const content = 'Booster is fine, and so is [Booster](https://x.test).';

        expect(retargetWikiLinks(content, 'Booster', 'Rocket')).toBe(content);
    });

    it('does nothing when either title is blank', () => {
        // Renaming to an empty title would leave `[[]]` behind, and a note
        // that never had one has no links to find.
        expect(retargetWikiLinks('[[Booster]]', 'Booster', '  ')).toBe(
            '[[Booster]]',
        );
        expect(retargetWikiLinks('[[Booster]]', '', 'Rocket')).toBe(
            '[[Booster]]',
        );
    });

    it('writes a title the parser reads back as the new target', () => {
        const rewritten = retargetWikiLinks(
            '- [ ] Ship [[Booster|v1]]',
            'Booster',
            'Rocket Booster',
        );
        const [line] = parseNote(rewritten);

        expect(line.wikiLinks).toHaveLength(1);
        expect(line.wikiLinks[0].target).toBe('Rocket Booster');
        expect(line.wikiLinks[0].display).toBe('v1');
    });
});

describe('applyTitleRenames', () => {
    it('applies several renames in one pass', () => {
        expect(
            applyTitleRenames('[[Alpha]] [[Beta]] [[Gamma]]', [
                { from: 'Alpha', to: 'One' },
                { from: 'Beta', to: 'Two' },
            ]),
        ).toBe('[[One]] [[Two]] [[Gamma]]');
    });

    it('never hands a link down a chain of renames', () => {
        // Two notes swapping titles: a link to Alpha belongs on Beta, not on
        // Gamma via Beta's rename.
        expect(
            applyTitleRenames('[[Alpha]] [[Beta]]', [
                { from: 'Alpha', to: 'Beta' },
                { from: 'Beta', to: 'Gamma' },
            ]),
        ).toBe('[[Beta]] [[Gamma]]');
    });

    it('returns the content untouched when nothing matches', () => {
        const content = 'No links here at all.';

        expect(applyTitleRenames(content, [{ from: 'Alpha', to: 'One' }])).toBe(
            content,
        );
        expect(applyTitleRenames(content, [])).toBe(content);
    });
});
