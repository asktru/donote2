<?php

namespace App\Actions\Notes;

class AppendUnderHeading
{
    public function __construct(protected DoneSection $doneSection) {}

    /**
     * Append markdown at the end of the named heading's section, matching
     * the heading text case-insensitively at any level. A missing heading
     * is created as an H2 at the bottom of the note (unless disabled, in
     * which case the text is appended plainly). A null heading appends
     * plainly at the end of the note.
     *
     * "The bottom of the note" means the bottom of its *body*: a `# Done`
     * section runs to the end of the note and is collapsed by default, so
     * appending past it would file new work into the archive, out of sight.
     * A heading inside the archive is not matched either — the groups
     * rebuilt in there mirror the body's own headings, and appending to one
     * would drop live work among finished work.
     */
    public function execute(string $content, ?string $heading, string $text, bool $createHeadingIfMissing = true): string
    {
        [$body, $section] = $this->doneSection->split($content);

        return $this->doneSection->join(
            $this->appendToBody($body, $heading, $text, $createHeadingIfMissing),
            $section,
        );
    }

    private function appendToBody(string $body, ?string $heading, string $text, bool $createHeadingIfMissing): string
    {
        $text = rtrim($text, "\n");
        $heading = $heading !== null ? trim($heading) : null;

        if ($heading === null || $heading === '') {
            return $this->appendPlainly($body, $text);
        }

        $lines = $body === '' ? [] : explode("\n", $body);
        $pattern = '/^(#{1,6})\s+'.preg_quote($heading, '/').'\s*$/iu';

        $headingIndex = null;
        $level = 2;

        foreach ($lines as $index => $line) {
            if (preg_match($pattern, $line, $matches) === 1) {
                $headingIndex = $index;
                $level = strlen($matches[1]);
                break;
            }
        }

        if ($headingIndex === null) {
            if (! $createHeadingIfMissing) {
                return $this->appendPlainly($body, $text);
            }

            $base = rtrim($body, "\n");
            $prefix = $base === '' ? '' : $base."\n\n";

            return $prefix.'## '.$heading."\n".$text."\n";
        }

        // The section runs until the next heading of the same or a higher
        // level; insert after its last non-blank line so any blank line
        // separating the following heading stays in place.
        $sectionEnd = count($lines);
        $boundary = '/^#{1,'.$level.'}\s/';

        for ($i = $headingIndex + 1; $i < count($lines); $i++) {
            if (preg_match($boundary, $lines[$i]) === 1) {
                $sectionEnd = $i;
                break;
            }
        }

        $insertAt = $headingIndex + 1;

        for ($i = $sectionEnd - 1; $i > $headingIndex; $i--) {
            if (trim($lines[$i]) !== '') {
                $insertAt = $i + 1;
                break;
            }
        }

        array_splice($lines, $insertAt, 0, explode("\n", $text));

        $result = implode("\n", $lines);

        return str_ends_with($result, "\n") ? $result : $result."\n";
    }

    private function appendPlainly(string $content, string $text): string
    {
        $base = rtrim($content, "\n");

        return ($base === '' ? '' : $base."\n").$text."\n";
    }
}
