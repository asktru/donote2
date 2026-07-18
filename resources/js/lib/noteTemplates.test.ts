import { describe, expect, it } from 'vitest';

import {
    defaultTemplateMonth,
    isTemplateNote,
    parseTemplateParts,
    renderTemplate,
    substituteTokens,
} from './noteTemplates';

const TEMPLATE = [
    '---',
    'title: Revenue Accrual Checklist',
    'type: empty-note',
    '---',
    '--',
    'type: project',
    'review: +3d',
    '--',
    '# Revenue Accrual — %monthName% %yearShort%',
    '',
    '## YouTube',
    "+ [ ] Run `php artisan youtube:process %year% %month% \"o&o\"`",
    "+ [ ] Expire before '%year%-%month0%-01'",
    '+ [ ] Compare with %prevYear%-%prevMonth0%',
    '+ [ ] [report](https://example.com/x?q=a%20reports%2Cin%20desc)',
].join('\n');

describe('isTemplateNote', () => {
    it('matches the Templates folder and its subfolders only', () => {
        expect(isTemplateNote({ folder: 'Templates' })).toBe(true);
        expect(isTemplateNote({ folder: 'Templates/Monthly' })).toBe(true);
        expect(isTemplateNote({ folder: 'TemplatesOld' })).toBe(false);
        expect(isTemplateNote({ folder: '' })).toBe(false);
    });
});

describe('parseTemplateParts', () => {
    it('splits metadata, output front matter, title and body', () => {
        const parts = parseTemplateParts(TEMPLATE);

        expect(parts.frontMatter).toBe('type: project\nreview: +3d');
        expect(parts.titleTemplate).toBe(
            'Revenue Accrual — %monthName% %yearShort%',
        );
        expect(parts.body.startsWith('## YouTube')).toBe(true);
    });

    it('treats a plain note as body only', () => {
        const parts = parseTemplateParts('Just some text\n- [ ] a task');

        expect(parts.frontMatter).toBeNull();
        expect(parts.titleTemplate).toBeNull();
        expect(parts.body).toBe('Just some text\n- [ ] a task');
    });
});

describe('renderTemplate', () => {
    it('renders the May 2026 accrual note', () => {
        const rendered = renderTemplate(TEMPLATE, 'fallback', {
            year: 2026,
            month: 5,
        });

        expect(rendered.title).toBe('Revenue Accrual — May 26');
        expect(rendered.content.startsWith('---\ntype: project\nreview: +3d\n---\n')).toBe(
            true,
        );
        expect(rendered.content).toContain('youtube:process 2026 5 "o&o"');
        expect(rendered.content).toContain("before '2026-05-01'");
        expect(rendered.content).toContain('Compare with 2026-04');
    });

    it('leaves URL-encoded sequences untouched', () => {
        const rendered = renderTemplate(TEMPLATE, 'fallback', {
            year: 2026,
            month: 5,
        });

        expect(rendered.content).toContain('a%20reports%2Cin%20desc');
    });

    it('rolls prev tokens across the year boundary', () => {
        const out = substituteTokens(
            '%prevYear%-%prevMonth0% (%prevMonthName% %prevYearShort%)',
            { year: 2026, month: 1 },
        );

        expect(out).toBe('2025-12 (December 25)');
    });

    it('falls back to the template title when no heading exists', () => {
        const rendered = renderTemplate('- [ ] a task', 'daily-journal', {
            year: 2026,
            month: 7,
        });

        expect(rendered.title).toBe('daily-journal');
        expect(rendered.content).toBe('- [ ] a task');
    });
});

describe('defaultTemplateMonth', () => {
    it('suggests the previous month', () => {
        expect(defaultTemplateMonth(new Date(2026, 6, 18))).toEqual({
            year: 2026,
            month: 6,
        });
        expect(defaultTemplateMonth(new Date(2026, 0, 5))).toEqual({
            year: 2025,
            month: 12,
        });
    });
});
