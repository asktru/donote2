<?php

namespace App\Actions\Notes;

/**
 * PHP port of the client's Done section (resources/js/core/doneSection.ts):
 * a `# Done` heading at the end of a note archives finished work, and runs
 * to the end of the note by definition.
 *
 * Server-side writes need to know where it starts for one reason: appending
 * to the end of a note's *text* would put new work inside the archive, which
 * is collapsed by default and reads as already done.
 */
class DoneSection
{
    /** The heading that opens the section, fold marker (" …") and all. */
    protected const HEADING_PATTERN = '/^#[ \t]+done(?:[ \t]*…)?[ \t]*$/iu';

    /**
     * Index of the note's Done heading among its lines, or null. The *last*
     * match wins: a note may mention "# Done" earlier, and only the trailing
     * section is the archive.
     *
     * @param  array<int, string>  $lines
     */
    public function headingIndex(array $lines): ?int
    {
        for ($index = count($lines) - 1; $index >= 0; $index--) {
            if (preg_match(self::HEADING_PATTERN, $lines[$index]) === 1) {
                return $index;
            }
        }

        return null;
    }

    /**
     * How many lines of the note are body — everything above the section and
     * the `---` separator that introduces it. The whole line count when there
     * is no section.
     *
     * @param  array<int, string>  $lines
     */
    public function bodyLineCount(array $lines): int
    {
        $heading = $this->headingIndex($lines);

        if ($heading === null) {
            return count($lines);
        }

        $end = $heading;

        if ($end > 0 && trim($lines[$end - 1]) === '---') {
            $end--;
        }

        while ($end > 0 && trim($lines[$end - 1]) === '') {
            $end--;
        }

        return $end;
    }

    /**
     * Split a note into its body and its Done section, so a caller can work
     * on the body and put the archive back untouched. The section is '' when
     * the note has none.
     *
     * @return array{0: string, 1: string}
     */
    public function split(string $content): array
    {
        $lines = $content === '' ? [] : explode("\n", $content);
        $bodyCount = $this->bodyLineCount($lines);

        if ($bodyCount === count($lines)) {
            return [$content, ''];
        }

        return [
            implode("\n", array_slice($lines, 0, $bodyCount)),
            implode("\n", array_slice($lines, $bodyCount)),
        ];
    }

    /**
     * Put a body and a Done section back together, with the blank line the
     * separator wants above it.
     */
    public function join(string $body, string $section): string
    {
        $section = ltrim($section, "\n");

        if ($section === '') {
            return $body;
        }

        $body = rtrim($body, "\n");

        return ($body === '' ? '' : $body."\n\n").$section;
    }
}
