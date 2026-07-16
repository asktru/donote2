import { describe, expect, it } from 'vitest';

import {
    appendLine,
    sharedAttachmentLine,
    sharedNoteContent,
    sharedNoteTitle,
} from './shareInbox';

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
    it('stacks link, quoted description, and comment as paragraphs', () => {
        expect(
            sharedNoteContent({
                id: '1',
                kind: 'url',
                url: 'https://example.com',
                description: 'First line\nSecond line',
                comment: 'Read this later',
            }),
        ).toBe(
            'https://example.com\n\n> First line\n> Second line\n\nRead this later',
        );
    });

    it('omits empty sections without leaving blank artifacts', () => {
        expect(
            sharedNoteContent({ id: '1', kind: 'url', url: 'https://a.io' }),
        ).toBe('https://a.io');
    });

    it('keeps shared text unquoted', () => {
        expect(
            sharedNoteContent({
                id: '1',
                kind: 'text',
                description: 'Copied paragraph',
            }),
        ).toBe('Copied paragraph');
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
