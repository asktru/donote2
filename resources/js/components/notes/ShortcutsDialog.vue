<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { shortcutsOpen } from '@/stores/ui';

interface ShortcutGroup {
    title: string;
    shortcuts: [keys: string, description: string][];
}

const groups: ShortcutGroup[] = [
    {
        title: 'Navigation',
        shortcuts: [
            ['⌘K', 'Search notes / quick open'],
            ['⌘T', "Go to today's daily note"],
            ['⌘1', 'Focus main pane'],
            ['⌘2', 'Focus split pane'],
            ['⌘\\', 'Close split pane'],
            [
                'Click tag / date / [[link]]',
                'Open it (when not editing that line)',
            ],
            ['⌥-click token', 'Open in split pane'],
            ['⌘⏎ / ⌘⌥⏎', 'Open token under cursor (main / split)'],
            ['⌘/', 'Show this cheatsheet'],
        ],
    },
    {
        title: 'Tasks & checklists',
        shortcuts: [
            ['⌘L', 'Turn line into a task (and back)'],
            ['⌘⇧L', 'Turn line into a checklist item (and back)'],
            ['⌘⏎', 'Complete / reopen task (link under cursor wins)'],
            ['⌘⇧⏎', 'Cancel / restore task'],
            ['⌘⇧S', 'Schedule task (>date, date selected)'],
            ['⌘⇧D', 'Set due date (@due(date), date selected)'],
            ['Tab / ⇧Tab', 'Indent / outdent line'],
            ['⌘⇧Y', 'Make synced line + copy (paste it anywhere)'],
            ['⌘⌥[ / ⌘⌥]', 'Collapse / expand section at cursor'],
            ['⌃⌥[ / ⌃⌥]', 'Collapse / expand everything'],
        ],
    },
    {
        title: 'Formatting',
        shortcuts: [
            ['⌘B', 'Bold'],
            ['⌘I', 'Italic'],
            ['⌘E', 'Inline code'],
            ['⌘⇧X', 'Strikethrough'],
            ['[[', 'Link a note (autocompletes)'],
            ['# / @', 'Tag or mention (autocompletes)'],
        ],
    },
    {
        title: 'Note types (front matter)',
        shortcuts: [
            [
                'type: project / area / list',
                'Typed note with icon + progress pie',
            ],
            ['start: 2026-08-01', 'Project start (future = muted)'],
            ['due: 2026-09-30', 'Project deadline countdown'],
            ['review: 2w / Sat / 20th', 'Review cadence (GTD)'],
            ['reviewed: date', 'Stamped by “Mark reviewed”'],
        ],
    },
    {
        title: 'Task syntax',
        shortcuts: [
            ['!!! / !! / !', 'Priority (red / orange / blue)'],
            ['>2026-07-15', 'Schedule for a day'],
            ['>2026-W30 / >2026-09', 'Schedule for a week / month'],
            ['>2026-Q4 / >2026', 'Schedule for a quarter / year'],
            ['@due(2026-07-20)', 'Deadline'],
            ['@repeat(3d / +3d / Tue,Thu / 20th)', 'Repeat rules'],
            ['@8am / @14:30', 'Reminder'],
            ['text ^abc123', 'Synced line — one edit updates all copies'],
        ],
    },
];
</script>

<template>
    <Dialog v-model:open="shortcutsOpen">
        <DialogContent class="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogTitle>Keyboard shortcuts</DialogTitle>

            <div class="grid gap-6 sm:grid-cols-2">
                <section v-for="group in groups" :key="group.title">
                    <h3
                        class="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                        {{ group.title }}
                    </h3>
                    <dl class="space-y-1.5">
                        <div
                            v-for="[keys, description] in group.shortcuts"
                            :key="keys"
                            class="flex items-baseline justify-between gap-3"
                        >
                            <dt class="text-sm text-foreground/90">
                                {{ description }}
                            </dt>
                            <dd class="shrink-0">
                                <kbd
                                    class="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-sans text-[11px] whitespace-nowrap text-muted-foreground"
                                >
                                    {{ keys }}
                                </kbd>
                            </dd>
                        </div>
                    </dl>
                </section>
            </div>

            <p class="text-xs text-muted-foreground">
                On Windows/Linux use Ctrl instead of ⌘.
            </p>
        </DialogContent>
    </Dialog>
</template>
