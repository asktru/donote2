<?php

use App\Actions\Notes\AppendUnderHeading;
use App\Actions\Notes\DoneSection;

function appendUnderHeading(string $content, ?string $heading, string $text, bool $create = true): string
{
    return (new AppendUnderHeading(new DoneSection))->execute($content, $heading, $text, $create);
}

test('a null heading appends plainly at the end', function () {
    expect(appendUnderHeading("- [ ] task\n", null, '- note'))
        ->toBe("- [ ] task\n- note\n");

    expect(appendUnderHeading('', null, '- note'))->toBe("- note\n");
});

test('a missing heading is created as an h2 at the bottom', function () {
    expect(appendUnderHeading("Morning thoughts.\n", 'Links', '- [[A]]'))
        ->toBe("Morning thoughts.\n\n## Links\n- [[A]]\n");

    expect(appendUnderHeading('', 'Links', '- [[A]]'))
        ->toBe("## Links\n- [[A]]\n");
});

test('a missing heading appends plainly when creation is disabled', function () {
    expect(appendUnderHeading("Text.\n", 'Links', '- [[A]]', create: false))
        ->toBe("Text.\n- [[A]]\n");
});

test('text lands at the end of the matched section', function () {
    $content = "## Links\n- [[A]]\n\n## Journal\nGood day.\n";

    expect(appendUnderHeading($content, 'Links', '- [[B]]'))
        ->toBe("## Links\n- [[A]]\n- [[B]]\n\n## Journal\nGood day.\n");
});

test('the heading matches case-insensitively at any level', function () {
    $content = "### links\n- [[A]]\n";

    expect(appendUnderHeading($content, 'Links', '- [[B]]'))
        ->toBe("### links\n- [[A]]\n- [[B]]\n");
});

test('a deeper subheading stays inside the section', function () {
    $content = "## Links\n### Reading\n- [[A]]\n\n## Next\n";

    expect(appendUnderHeading($content, 'Links', '- [[B]]'))
        ->toBe("## Links\n### Reading\n- [[A]]\n- [[B]]\n\n## Next\n");
});

test('an empty section gets the text right under the heading', function () {
    $content = "## Links\n\n## Journal\nEntry.\n";

    expect(appendUnderHeading($content, 'Links', '- [[A]]'))
        ->toBe("## Links\n- [[A]]\n\n## Journal\nEntry.\n");
});

test('a section at the end of the note grows at the bottom', function () {
    $content = "# Day\n\n## Links\n- [[A]]\n";

    expect(appendUnderHeading($content, 'Links', '- [[B]]'))
        ->toBe("# Day\n\n## Links\n- [[A]]\n- [[B]]\n");
});

test('a missing heading is created above the Done section, not after it', function () {
    // The section runs to the end of the note and is collapsed by default:
    // appending past it files new work into the archive, out of sight.
    $note = implode("\n", [
        '# Launch',
        '- [ ] Ship it',
        '',
        '---',
        '# Done …',
        '## Launch',
        '- [x] Tag v1.0',
    ]);

    expect(appendUnderHeading($note, 'Meetings', '- [[Anton <> Max]]'))
        ->toBe(implode("\n", [
            '# Launch',
            '- [ ] Ship it',
            '',
            '## Meetings',
            '- [[Anton <> Max]]',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
        ]));
});

test('a plain append lands above the Done section too', function () {
    $note = implode("\n", ['- [ ] Ship it', '', '---', '# Done …', '- [x] Tag']);

    expect(appendUnderHeading($note, null, '- new'))
        ->toBe(implode("\n", [
            '- [ ] Ship it',
            '- new',
            '',
            '---',
            '# Done …',
            '- [x] Tag',
        ]));
});

test('a heading inside the Done section is never matched', function () {
    // The archive rebuilds the body's headings, so "Meetings" can exist in
    // both places — appending to the archived one would bury live work.
    $note = implode("\n", [
        '# Launch',
        '',
        '---',
        '# Done …',
        '## Meetings',
        '- [[Old meeting]]',
    ]);

    expect(appendUnderHeading($note, 'Meetings', '- [[New meeting]]'))
        ->toBe(implode("\n", [
            '# Launch',
            '',
            '## Meetings',
            '- [[New meeting]]',
            '',
            '---',
            '# Done …',
            '## Meetings',
            '- [[Old meeting]]',
        ]));
});

test('a note without a Done section is untouched by the split', function () {
    expect(appendUnderHeading("# Launch\n- [ ] Ship it\n", 'Meetings', '- [[Anton]]'))
        ->toBe("# Launch\n- [ ] Ship it\n\n## Meetings\n- [[Anton]]\n");
});
