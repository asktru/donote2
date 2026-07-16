import { describe, expect, it } from 'vitest';

import {
    appendLine,
    appendUnderHeading,
    itemsForTeam,
    sharedAttachmentLine,
    sharedNoteContent,
    sharedNoteTitle,
} from './shareInbox';
import type { ShareInboxItem } from './shareInbox';

describe('itemsForTeam', () => {
    const item = (id: string, teamSlug?: string): ShareInboxItem => ({
        id,
        kind: 'url',
        teamSlug,
    });

    it('keeps items routed to the open team and untagged legacy items', () => {
        expect(
            itemsForTeam(
                [item('a', 'alpha'), item('b', 'beta'), item('c')],
                'alpha',
            ).map((entry) => entry.id),
        ).toEqual(['a', 'c']);
    });

    it('leaves other teams’ shares queued', () => {
        expect(itemsForTeam([item('b', 'beta')], 'alpha')).toEqual([]);
    });
});

describe('sharedNoteTitle', () => {
    it('uses the page title when present', () => {
        expect(
            sharedNoteTitle({
                id: '1',
                kind: 'url',
                title: 'Laravel News',
                url: 'https://laravel-news.com/post',
            }),
        ).toBe('Laravel News');
    });

    it('falls back to the hostname without www', () => {
        expect(
            sharedNoteTitle({
                id: '1',
                kind: 'url',
                url: 'https://www.example.com/some/page',
            }),
        ).toBe('example.com');
    });

    it('stubs out untitled text and unparsable links', () => {
        expect(sharedNoteTitle({ id: '1', kind: 'text' })).toBe('Shared text');
        expect(sharedNoteTitle({ id: '1', kind: 'url', url: '::' })).toBe(
            'Shared link',
        );
    });
});

describe('sharedNoteContent', () => {
    it('builds the structured web-clip layout with all sections', () => {
        expect(
            sharedNoteContent(
                {
                    id: '1',
                    kind: 'url',
                    url: 'https://example.com/post',
                    description: 'Real CPM/RPM data\nby niche',
                    comment: 'Read this later',
                },
                'This is a blog article explaining payouts.',
            ),
        ).toBe(
            [
                '- URL: https://example.com/post',
                '- Description',
                '    - Real CPM/RPM data by niche',
                '- Summary',
                '    - This is a blog article explaining payouts.',
                '- Comment',
                '    - Read this later',
                '',
                '#web',
            ].join('\n'),
        );
    });

    it('omits missing sections but keeps the #web tag', () => {
        expect(
            sharedNoteContent({ id: '1', kind: 'url', url: 'https://a.io' }),
        ).toBe('- URL: https://a.io\n\n#web');
    });

    it('keeps shared plain text as a plain note', () => {
        expect(
            sharedNoteContent({
                id: '1',
                kind: 'text',
                description: 'Copied paragraph',
                comment: 'from a chat',
            }),
        ).toBe('Copied paragraph\n\nfrom a chat');
    });
});

describe('sharedNoteTitle sanitization', () => {
    it('strips wiki-hostile characters so the title works as a [[target]]', () => {
        expect(
            sharedNoteTitle({
                id: '1',
                kind: 'url',
                title: 'A [Guide] | Part 2',
                url: 'https://example.com',
            }),
        ).toBe('A Guide Part 2');
    });
});

describe('appendUnderHeading', () => {
    it('appends after the last item of an existing Links block', () => {
        const daily = '# Tue\n\n## Links\n- [[First]]\n\n## Tasks\n- [ ] x\n';

        expect(appendUnderHeading(daily, '## Links', '- [[Second]]')).toBe(
            '# Tue\n\n## Links\n- [[First]]\n- [[Second]]\n\n## Tasks\n- [ ] x\n',
        );
    });

    it('creates the heading at the bottom when missing', () => {
        expect(
            appendUnderHeading('- [ ] task\n', '## Links', '- [[Clip]]'),
        ).toBe('- [ ] task\n\n## Links\n- [[Clip]]\n');
    });

    it('starts an empty daily note with the heading', () => {
        expect(appendUnderHeading('', '## Links', '- [[Clip]]')).toBe(
            '## Links\n- [[Clip]]\n',
        );
    });

    it('inserts directly under a heading with no items yet', () => {
        expect(
            appendUnderHeading('## Links\n\n## Other\n', '## Links', '- [[A]]'),
        ).toBe('## Links\n- [[A]]\n\n## Other\n');
    });
});

describe('sharedAttachmentLine', () => {
    it('appends the comment inline after the link', () => {
        expect(sharedAttachmentLine('![p](url)', 'whiteboard photo')).toBe(
            '![p](url) whiteboard photo',
        );
    });

    it('is just the link without a comment', () => {
        expect(sharedAttachmentLine('[f](url)', undefined)).toBe('[f](url)');
        expect(sharedAttachmentLine('[f](url)', '  ')).toBe('[f](url)');
    });
});

describe('appendLine', () => {
    it('appends to existing content one newline apart', () => {
        expect(appendLine('# Today\n\n- [ ] task\n', '![p](url)')).toBe(
            '# Today\n\n- [ ] task\n![p](url)\n',
        );
    });

    it('starts an empty note cleanly', () => {
        expect(appendLine('', '![p](url)')).toBe('![p](url)\n');
        expect(appendLine('\n\n', '![p](url)')).toBe('![p](url)\n');
    });
});
