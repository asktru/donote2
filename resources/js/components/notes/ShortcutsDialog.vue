<script setup lang="ts">
import { Search } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

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
            ['⌘K', 'Search notes / recent history'],
            ['⌘T', "Go to today's daily note"],
            [
                '⌘1 … ⌘5',
                "Today's daily / weekly / monthly / quarterly / yearly note",
            ],
            ['⌘⌥← / ⌘⌥→', 'Focus main / split pane'],
            ['Esc', 'Close split pane'],
            ['⌘⇧G', 'Connections graph for the current note (split)'],
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
        title: 'Notes & folders',
        shortcuts: [
            ['⌘N', 'New note (in the current folder)'],
            ['⌘⇧N', 'New folder (in the current folder)'],
            ['⌘⇧Y', 'Make synced line + copy (paste it anywhere)'],
            ['⌘⇧R', 'Start / stop voice recording (desktop app)'],
            ['⌃⌥R', 'Start / stop voice recording (browser)'],
            ['⌘J', 'AI prompt on selection / note'],
            ['⌘⌥/', 'Collapse all sidebar folders'],
            ['⌃S', 'Reveal current note in the sidebar'],
        ],
    },
    {
        title: 'Tasks & checklists',
        shortcuts: [
            ['⌘L', 'Turn line into a task (and back)'],
            ['⌘⇧L', 'Turn line into a checklist item (and back)'],
            ['⌘⏎', 'Complete / reopen task (link under cursor wins)'],
            ['⌘⇧⏎', 'Cancel / restore task'],
            ['⌘⇧1', 'Cycle priority (! → !! → !!! → none)'],
            ['⌘⌃↑ / ⌘⌃↓', 'Move line(s) up / down'],
            ['⌘⇧S', 'Schedule task (>date, date selected)'],
            ['⌘⇧D', 'Set due date (@due(date), date selected)'],
            ['Tab / ⇧Tab', 'Indent / outdent line'],
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
            ['⌘⇧H', 'Highlight (==text==)'],
            ['[[', 'Link a note (autocompletes)'],
            ['# / @', 'Tag or mention (autocompletes)'],
            ['// comment', 'Muted end-of-line comment'],
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

const query = ref('');

watch(shortcutsOpen, (open) => {
    if (open) {
        query.value = '';
    }
});

const filteredGroups = computed<ShortcutGroup[]>(() => {
    const needle = query.value.trim().toLowerCase();

    if (needle === '') {
        return groups;
    }

    return groups
        .map((group) => ({
            title: group.title,
            shortcuts: group.shortcuts.filter(
                ([keys, description]) =>
                    keys.toLowerCase().includes(needle) ||
                    description.toLowerCase().includes(needle) ||
                    group.title.toLowerCase().includes(needle),
            ),
        }))
        .filter((group) => group.shortcuts.length > 0);
});
</script>

<template>
    <Dialog v-model:open="shortcutsOpen">
        <DialogContent class="flex max-h-[80vh] max-w-lg flex-col gap-0 p-0">
            <DialogTitle class="px-4 pt-4 pb-2">Keyboard shortcuts</DialogTitle>

            <div
                class="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5"
            >
                <Search class="size-4 shrink-0 text-muted-foreground" />
                <input
                    v-model="query"
                    class="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search shortcuts… (e.g. “split”, “priority”)"
                    autofocus
                />
            </div>

            <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
                <section v-for="group in filteredGroups" :key="group.title">
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

                <p
                    v-if="filteredGroups.length === 0"
                    class="py-6 text-center text-sm text-muted-foreground"
                >
                    No shortcuts match “{{ query }}”.
                </p>

                <p class="text-xs text-muted-foreground">
                    On Windows/Linux use Ctrl instead of ⌘. ⌘N may be reserved
                    by your browser — it always works in the desktop app.
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
