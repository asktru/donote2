import { describe, expect, it } from 'vitest';

import { bareUrl, knownLinkTitle, pasteAsMarkdownLink } from './pasteLinks';

describe('bareUrl', () => {
    it('accepts a single http(s) URL, with surrounding whitespace', () => {
        expect(bareUrl('https://claude.ai')).toBe('https://claude.ai');
        expect(bareUrl('  https://claude.ai/chat?x=1#y \n')).toBe(
            'https://claude.ai/chat?x=1#y',
        );
    });

    it('rejects non-URLs, multi-word text, and multiline pastes', () => {
        expect(bareUrl('hello')).toBeNull();
        expect(bareUrl('see https://claude.ai')).toBeNull();
        expect(bareUrl('https://a.io\nhttps://b.io')).toBeNull();
        expect(bareUrl('ftp://files.example.com')).toBeNull();
    });
});

describe('knownLinkTitle', () => {
    it('titles ClickUp chat links', () => {
        expect(
            knownLinkTitle(
                'https://app.clickup.com/9003144822/chat/r/8ca25kp-177832/t/80120054512050',
            ),
        ).toBe('ClickUp Chat');
    });

    it('titles ClickUp tasks by their id', () => {
        expect(
            knownLinkTitle('https://app.clickup.com/t/9003144822/PT-12817'),
        ).toBe('ClickUp: PT-12817');
        expect(knownLinkTitle('https://app.clickup.com/t/86abc123')).toBe(
            'ClickUp: 86abc123',
        );
    });

    it('falls back to a plain ClickUp label for other ClickUp pages', () => {
        expect(
            knownLinkTitle('https://app.clickup.com/9003144822/v/l/li/901star'),
        ).toBe('ClickUp');
    });

    it('knows nothing about other hosts', () => {
        expect(knownLinkTitle('https://claude.ai')).toBeNull();
        expect(knownLinkTitle('not a url')).toBeNull();
    });
});

describe('pasteAsMarkdownLink', () => {
    it('uses the selected text as the link title', () => {
        expect(pasteAsMarkdownLink('https://claude.ai', 'test')).toBe(
            '[test](https://claude.ai)',
        );
    });

    it('prefers the selection over a known title', () => {
        expect(
            pasteAsMarkdownLink(
                'https://app.clickup.com/t/9003144822/PT-12817',
                'the PT ticket',
            ),
        ).toBe('[the PT ticket](https://app.clickup.com/t/9003144822/PT-12817)');
    });

    it('titles known URLs even without a selection', () => {
        expect(
            pasteAsMarkdownLink(
                'https://app.clickup.com/t/9003144822/PT-12817',
                '',
            ),
        ).toBe('[ClickUp: PT-12817](https://app.clickup.com/t/9003144822/PT-12817)');
    });

    it('passes through unknown URLs without a selection', () => {
        expect(pasteAsMarkdownLink('https://claude.ai', '')).toBeNull();
    });

    it('passes through non-URL pastes even over a selection', () => {
        expect(pasteAsMarkdownLink('plain text', 'test')).toBeNull();
    });

    it('sanitizes brackets in the title', () => {
        expect(pasteAsMarkdownLink('https://claude.ai', 'a [b] c')).toBe(
            '[a b c](https://claude.ai)',
        );
    });
});
