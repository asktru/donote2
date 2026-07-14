import { describe, expect, it } from 'vitest';

import { inlineSegments } from './inlineTitle';

describe('inlineSegments', () => {
    it('returns a single plain segment for plain text', () => {
        expect(inlineSegments('Buy milk')).toEqual([
            { kind: 'plain', text: 'Buy milk' },
        ]);
    });

    it('styles a trailing tag', () => {
        expect(inlineSegments('Send the pizza form #mac')).toEqual([
            { kind: 'plain', text: 'Send the pizza form ' },
            { kind: 'tag', text: '#mac' },
        ]);
    });

    it('styles bold and a mention', () => {
        expect(inlineSegments('Call **Ivan** @ivan')).toEqual([
            { kind: 'plain', text: 'Call ' },
            { kind: 'bold', text: 'Ivan' },
            { kind: 'plain', text: ' ' },
            { kind: 'mention', text: '@ivan' },
        ]);
    });

    it('shows a wiki link by its display text', () => {
        expect(inlineSegments('See [[Project X|the project]]')).toEqual([
            { kind: 'plain', text: 'See ' },
            { kind: 'wikilink', text: 'the project' },
        ]);
    });

    it('does not treat a mid-word # or @ as a token', () => {
        expect(inlineSegments('C#5 email a@b.com')).toEqual([
            { kind: 'plain', text: 'C#5 email a@b.com' },
        ]);
    });

    it('handles highlight and inline code', () => {
        expect(inlineSegments('==urgent== run `build`')).toEqual([
            { kind: 'highlight', text: 'urgent' },
            { kind: 'plain', text: ' run ' },
            { kind: 'code', text: 'build' },
        ]);
    });
});
