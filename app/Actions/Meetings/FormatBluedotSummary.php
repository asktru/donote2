<?php

namespace App\Actions\Meetings;

class FormatBluedotSummary
{
    /**
     * Turn a Bluedot summary into Donote markdown that matches the meeting
     * notes we already keep: underlined-bold sub-headings become `###`
     * headings, and the bullets under `## Action Items` become checklist
     * items (`+ [ ]`) so they read as trackable per-person to-dos. Topic
     * bullets are left as plain bullets.
     */
    public function execute(string $summary): string
    {
        // <u>**Heading**</u> → ### Heading (Bluedot underlines its section
        // sub-titles); drop any stray tags left over.
        $summary = preg_replace('/<u>\s*\*\*(.+?)\*\*\s*<\/u>/u', '### $1', $summary) ?? $summary;
        $summary = str_replace(['<u>', '</u>'], '', $summary);

        $lines = explode("\n", $summary);
        $inActionItems = false;

        foreach ($lines as $index => $line) {
            // Only an H2 delimits a section — the `### Person` subheadings
            // inside Action Items must not flip the flag off.
            if (preg_match('/^##(?!#)\s/', $line) === 1) {
                $inActionItems = preg_match('/^##\s+Action Items\s*$/i', $line) === 1;

                continue;
            }

            // Within Action Items, promote a bullet to a checklist item.
            if ($inActionItems) {
                $lines[$index] = preg_replace(
                    '/^(\s*)[-*+]\s+(?!\[[ xX>-]\]\s)/',
                    '$1+ [ ] ',
                    $line,
                ) ?? $line;
            }
        }

        return trim(implode("\n", $lines))."\n";
    }
}
