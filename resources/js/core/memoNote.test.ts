import { describe, expect, it } from 'vitest';

import {
    appendLine,
    appendUnderAudioMemo,
    appendUnderHeading,
    safeDailyKey,
    stitchTranscript,
} from './memoNote';

describe('appendUnderAudioMemo', () => {
    it('creates the parent bullet in an empty note', () => {
        expect(appendUnderAudioMemo('', '10:15 — hello world')).toBe(
            '- [[Audio memo]]\n    - 10:15 — hello world\n',
        );
    });

    it('appends the parent after existing content with a separating blank line', () => {
        expect(appendUnderAudioMemo('## Plan\n- [ ] task\n', 'note')).toBe(
            '## Plan\n- [ ] task\n\n- [[Audio memo]]\n    - note\n',
        );
    });

    it('nests under an existing parent after its last child', () => {
        const content =
            '- [[Audio memo]]\n    - 09:00 — first\n\n## Notes\n- bullet\n';

        expect(appendUnderAudioMemo(content, '10:30 — second')).toBe(
            '- [[Audio memo]]\n    - 09:00 — first\n    - 10:30 — second\n\n## Notes\n- bullet\n',
        );
    });

    it('collapses multi-line transcripts to one bullet line', () => {
        expect(appendUnderAudioMemo('', 'line one\nline two')).toContain(
            '    - line one line two',
        );
    });
});

describe('appendLine', () => {
    it('appends to empty content', () => {
        expect(appendLine('', '- [[New note]]')).toBe('- [[New note]]\n');
    });

    it('replaces trailing blank lines with the new line', () => {
        expect(appendLine('# Day\n\n', '- [[Idea]]')).toBe(
            '# Day\n- [[Idea]]\n',
        );
    });
});

describe('stitchTranscript', () => {
    it('joins parts in part order, collapsing whitespace', () => {
        expect(
            stitchTranscript([
                { part: 2, transcript: 'world' },
                { part: 0, transcript: 'hello  ' },
                { part: 1, transcript: '\n big' },
            ]),
        ).toBe('hello big world');
    });

    it('tolerates missing part transcripts', () => {
        expect(
            stitchTranscript([
                { part: 0, transcript: 'a' },
                { part: 1, transcript: null },
                { part: 2, transcript: 'b' },
            ]),
        ).toBe('a b');
    });
});

describe('safeDailyKey', () => {
    it('keeps a plausible current-era date', () => {
        expect(safeDailyKey('2026-07-24', '2026-07-25')).toBe('2026-07-24');
    });

    it('falls back for epoch/bogus or malformed keys', () => {
        expect(safeDailyKey('1970-01-01', '2026-07-25')).toBe('2026-07-25');
        expect(safeDailyKey('not-a-date', '2026-07-25')).toBe('2026-07-25');
    });
});

describe('appendUnderHeading', () => {
    it('creates the heading in an empty note', () => {
        expect(appendUnderHeading('', 'Audio Memos', '- [[Audio memo A]]')).toBe(
            '## Audio Memos\n- [[Audio memo A]]\n',
        );
    });

    it('stacks new links under an existing heading, in order', () => {
        const first = appendUnderHeading('', 'Audio Memos', '- [[A]]');
        expect(appendUnderHeading(first, 'Audio Memos', '- [[B]]')).toBe(
            '## Audio Memos\n- [[A]]\n- [[B]]\n',
        );
    });

    it('appends the heading block after existing content', () => {
        expect(
            appendUnderHeading('# Day\n\nnotes\n', 'Audio Memos', '- [[A]]'),
        ).toBe('# Day\n\nnotes\n\n## Audio Memos\n- [[A]]\n');
    });
});
