<script setup lang="ts">
import type { EditorView } from '@codemirror/view';
import {
    ArrowDown,
    ArrowUp,
    Ban,
    Bold,
    Calendar,
    CalendarClock,
    Check,
    ChevronDown,
    CircleCheckBig,
    FileOutput,
    Flag,
    Heading,
    Highlighter,
    IndentDecrease,
    IndentIncrease,
    Italic,
    List,
    SquareCheckBig,
} from '@lucide/vue';
import { computed } from 'vue';

import { editorLineActions } from '@/components/editor/markdownExtensions';
import { parseLine } from '@/core/parser';
import { isTouchDevice } from '@/lib/platform';
import {
    activeEditor,
    editorFocused,
    editorTick,
} from '@/stores/editorRegistry';
import { startMoveToNote } from '@/stores/move';

// Show whenever an editor is focused on a touch device. With the default
// Capacitor 'native' keyboard resize the web view shrinks to sit above the
// keyboard, so a bottom-pinned bar lands right on top of it — no need to
// measure the keyboard height (which is unreliable inside WKWebView).
const visible = computed(
    () => isTouchDevice && editorFocused.value && activeEditor.value !== null,
);

type Action = keyof typeof editorLineActions;

interface ToolbarButton {
    action: Action;
    icon: typeof Heading;
    label: string;
    /** Only meaningful on a task/checklist line — hidden elsewhere. */
    taskOnly?: boolean;
}

const groups: ToolbarButton[][] = [
    [
        { action: 'heading', icon: Heading, label: 'Heading' },
        // Task = circle, checklist = square, matching how they render in notes.
        { action: 'task', icon: CircleCheckBig, label: 'Task' },
        { action: 'checklist', icon: SquareCheckBig, label: 'Checklist' },
        { action: 'bullet', icon: List, label: 'Bullet' },
    ],
    [
        { action: 'complete', icon: Check, label: 'Complete / reopen', taskOnly: true },
        { action: 'schedule', icon: Calendar, label: 'Schedule', taskOnly: true },
        { action: 'due', icon: CalendarClock, label: 'Due date', taskOnly: true },
        { action: 'cancel', icon: Ban, label: 'Cancel / restore', taskOnly: true },
        { action: 'priority', icon: Flag, label: 'Cycle priority', taskOnly: true },
    ],
    [
        { action: 'bold', icon: Bold, label: 'Bold' },
        { action: 'italic', icon: Italic, label: 'Italic' },
        { action: 'highlight', icon: Highlighter, label: 'Highlight' },
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

/** True when the caret sits on a task or checklist line. */
const onTaskLine = computed<boolean>(() => {
    void editorTick.value; // recompute as the caret moves

    const view = activeEditor.value;

    if (!view) {
        return false;
    }

    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const kind = parseLine(line.text).kind;

    return kind === 'task' || kind === 'checklist';
});

/** Drop task-only buttons off task lines, then drop any emptied group. */
const visibleGroups = computed<ToolbarButton[][]>(() =>
    groups
        .map((group) =>
            group.filter((btn) => !btn.taskOnly || onTaskLine.value),
        )
        .filter((group) => group.length > 0),
);

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

// Tap-vs-swipe: pointerdown is prevented so a tap never steals focus from
// (and dismisses) the editor, but the action only fires on pointerup if the
// finger barely moved — a horizontal swipe scrolls the bar instead.
const TAP_SLOP = 10;
const gesture = { x: 0, y: 0, moved: false };

function onPointerDown(event: PointerEvent): void {
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.moved = false;
}

function onPointerMove(event: PointerEvent): void {
    if (
        Math.abs(event.clientX - gesture.x) > TAP_SLOP ||
        Math.abs(event.clientY - gesture.y) > TAP_SLOP
    ) {
        gesture.moved = true;
    }
}

function onTap(fn: () => void): void {
    if (!gesture.moved) {
        fn();
    }
}
</script>

<template>
    <!-- Sits just above the keyboard. The action strip scrolls; the dismiss
         button is pinned on the right so it's always reachable. -->
    <div
        v-show="visible"
        class="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border/60 bg-background/95 backdrop-blur"
    >
        <div class="flex flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5">
            <template v-for="(group, index) in visibleGroups" :key="index">
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
                    @pointerdown.prevent="onPointerDown"
                    @pointermove="onPointerMove"
                    @pointercancel="gesture.moved = true"
                    @pointerup="onTap(() => run(btn.action))"
                >
                    <component :is="btn.icon" class="size-5" />
                </button>
            </template>

            <div class="mx-0.5 h-6 w-px shrink-0 bg-border/70" />
            <button
                type="button"
                class="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground/80 active:bg-muted"
                aria-label="Move to note"
                @pointerdown.prevent="onPointerDown"
                @pointermove="onPointerMove"
                @pointercancel="gesture.moved = true"
                @pointerup="onTap(() => startMoveToNote())"
            >
                <FileOutput class="size-5" />
            </button>
        </div>

        <div
            class="flex shrink-0 items-center border-l border-border/70 px-2 py-1.5"
        >
            <button
                type="button"
                class="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-muted"
                aria-label="Dismiss keyboard"
                @pointerdown.prevent="onPointerDown"
                @pointermove="onPointerMove"
                @pointercancel="gesture.moved = true"
                @pointerup="onTap(dismiss)"
            >
                <ChevronDown class="size-5" />
            </button>
        </div>
    </div>
</template>
