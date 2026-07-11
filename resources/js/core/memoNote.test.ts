import { describe, expect, it } from 'vitest';

import { appendLine, appendUnderAudioMemo } from './memoNote';

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
