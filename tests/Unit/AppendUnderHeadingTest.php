<?php

use App\Actions\Notes\AppendUnderHeading;

function appendUnderHeading(string $content, ?string $heading, string $text, bool $create = true): string
{
    return (new AppendUnderHeading)->execute($content, $heading, $text, $create);
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
