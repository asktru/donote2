<script setup lang="ts">
import type { EditorView } from '@codemirror/view';
import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    FileOutput,
    Heading,
    IndentDecrease,
    IndentIncrease,
    List,
    ListChecks,
    SquareCheckBig,
} from '@lucide/vue';
import { computed } from 'vue';

import { editorLineActions } from '@/components/editor/markdownExtensions';
import { isTouchDevice } from '@/lib/platform';
import { activeEditor, editorFocused } from '@/stores/editorRegistry';
import { startMoveToNote } from '@/stores/move';

// Show whenever an editor is focused on a touch device. With the default
// Capacitor 'native' keyboard resize the web view shrinks to sit above the
// keyboard, so a bottom-pinned bar lands right on top of it — no need to
// measure the keyboard height (which is unreliable inside WKWebView).
const visible = computed(
    () => isTouchDevice && editorFocused.value && activeEditor.value !== null,
);

type Action = keyof typeof editorLineActions;

const groups: { action: Action; icon: typeof Heading; label: string }[][] = [
    [
        { action: 'heading', icon: Heading, label: 'Heading' },
        { action: 'task', icon: SquareCheckBig, label: 'Task' },
        { action: 'checklist', icon: ListChecks, label: 'Checklist' },
        { action: 'bullet', icon: List, label: 'Bullet' },
    ],
    [
        { action: 'outdent', icon: IndentDecrease, label: 'Outdent' },
        { action: 'indent', icon: IndentIncrease, label: 'Indent' },
    ],
    [
        { action: 'moveUp', icon: ArrowUp, label: 'Move up' },
        { action: 'moveDown', icon: ArrowDown, label: 'Move down' },
    ],
];

function run(action: Action): void {
    const view = activeEditor.value;

    if (!view) {
        return;
    }

    editorLineActions[action](view as EditorView);
    view.focus();
}

function dismiss(): void {
    activeEditor.value?.contentDOM.blur();
}
</script>

<template>
    <!-- Sits just above the keyboard. mousedown/touchstart are prevented so
         tapping a button never steals focus from (and dismisses) the editor. -->
    <div
        v-show="visible"
        class="fixed inset-x-0 bottom-0 z-50 flex items-center gap-1 overflow-x-auto border-t border-border/60 bg-background/95 px-2 py-1.5 backdrop-blur"
    >
        <template v-for="(group, index) in groups" :key="index">
            <div
                v-if="index > 0"
                class="mx-0.5 h-6 w-px shrink-0 bg-border/70"
            />
            <button
                v-for="btn in group"
                :key="btn.action"
                type="button"
                class="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground/80 active:bg-muted"
                :aria-label="btn.label"
                @mousedown.prevent
                @touchstart.prevent
                @click="run(btn.action)"
            >
                <component :is="btn.icon" class="size-5" />
            </button>
        </template>

        <div class="mx-0.5 h-6 w-px shrink-0 bg-border/70" />
        <button
            type="button"
            class="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground/80 active:bg-muted"
            aria-label="Move to note"
            @mousedown.prevent
            @touchstart.prevent
            @click="startMoveToNote()"
        >
            <FileOutput class="size-5" />
        </button>

        <button
            type="button"
            class="ml-auto flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-muted"
            aria-label="Dismiss keyboard"
            @mousedown.prevent
            @touchstart.prevent
            @click="dismiss"
        >
            <ChevronDown class="size-5" />
        </button>
    </div>
</template>
