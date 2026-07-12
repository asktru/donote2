<script setup lang="ts">
import { EditorState } from '@codemirror/state';
import { EditorView, placeholder as placeholderExt } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
    applyPersistedFolds,
    donoteMarkdown,
} from '@/components/editor/markdownExtensions';
import { attachmentHandlers } from '@/lib/attachments';
import { recallCursor, rememberCursor } from '@/lib/cursorMemory';
import {
    blurEditor,
    registerEditor,
    unregisterEditor,
} from '@/stores/editorRegistry';
import { liveNotes, tagCounts, mentionCounts } from '@/stores/workspace';

const props = defineProps<{
    modelValue: string;
    placeholder?: string;
    autofocus?: boolean;
    /** Identity used to remember/restore the cursor position (note id). */
    stateKey?: string;
    /**
     * Grow to the content's full height instead of scrolling internally, so
     * an outer container can scroll the editor and whatever follows it (the
     * references section) as one region.
     */
    grow?: boolean;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
    'open-link': [target: string, split: boolean];
    'open-date': [dateKey: string, split: boolean];
    'open-tag': [tag: string, split: boolean];
    'open-mention': [mention: string, split: boolean];
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
/** Guards against feeding our own emitted updates back into the editor. */
let lastEmitted: string | null = null;

function createView(): void {
    if (!host.value) {
        return;
    }

    const remembered = props.stateKey
        ? recallCursor(props.stateKey)
        : undefined;
    const initialCursor = Math.min(
        remembered ?? props.modelValue.length,
        props.modelValue.length,
    );

    view = new EditorView({
        parent: host.value,
        state: EditorState.create({
            doc: props.modelValue,
            selection: { anchor: initialCursor },
            extensions: [
                donoteMarkdown({
                    onOpenLink: (target, split) =>
                        emit('open-link', target, split),
                    onOpenDate: (dateKey, split) =>
                        emit('open-date', dateKey, split),
                    onOpenTag: (tag, split) => emit('open-tag', tag, split),
                    onOpenMention: (mention, split) =>
                        emit('open-mention', mention, split),
                    getNoteTitles: () =>
                        liveNotes.value
                            .filter(
                                (note) =>
                                    note.type === 'note' && note.title !== '',
                            )
                            .map((note) => note.title),
                    getTags: () => [...tagCounts.value.keys()],
                    getMentions: () => [...mentionCounts.value.keys()],
                }),
                placeholderExt(props.placeholder ?? 'Type something…'),
                attachmentHandlers(() => props.stateKey),
                EditorView.domEventHandlers({
                    focus: (_event, focusedView) =>
                        registerEditor(focusedView),
                    blur: (_event, blurredView) => blurEditor(blurredView),
                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        lastEmitted = update.state.doc.toString();
                        emit('update:modelValue', lastEmitted);
                    }

                    if (
                        (update.selectionSet || update.docChanged) &&
                        props.stateKey
                    ) {
                        rememberCursor(
                            props.stateKey,
                            update.state.selection.main.head,
                        );
                    }
                }),
            ],
        }),
    });

    if (props.autofocus) {
        view.focus();
    }

    // Bring the restored cursor position into view.
    view.dispatch({
        effects: EditorView.scrollIntoView(initialCursor, { y: 'center' }),
    });

    // Collapse sections whose lines carry the persisted " …" marker.
    applyPersistedFolds(view);
}

watch(
    () => props.modelValue,
    (value) => {
        if (
            !view ||
            value === lastEmitted ||
            value === view.state.doc.toString()
        ) {
            return;
        }

        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
        });
        // External replaces (sync pulls) reset folds; restore persisted ones.
        applyPersistedFolds(view);
    },
);

/** Scroll a given 0-based line into view and place the cursor there. */
function scrollToLine(index: number): void {
    if (!view) {
        return;
    }

    const lineNumber = Math.min(index + 1, view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);

    view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
}

function focus(): void {
    view?.focus();
}

defineExpose({ scrollToLine, focus });

onMounted(() => {
    createView();

    if (view) {
        registerEditor(view);
    }
});

onBeforeUnmount(() => {
    if (view) {
        unregisterEditor(view);
    }

    view?.destroy();
    view = null;
});
</script>

<template>
    <div
        ref="host"
        :class="[
            'donote-editor w-full cursor-text',
            grow ? 'is-grow' : 'h-full min-h-0',
        ]"
    ></div>
</template>

<style scoped>
.donote-editor :deep(.cm-editor) {
    height: 100%;
}
.donote-editor :deep(.cm-scroller) {
    overflow-y: auto;
    font-family: inherit;
}
/* Grow mode: the editor sizes to its content and an outer container owns
   the scroll, so the note and the references below it move as one. */
.donote-editor.is-grow :deep(.cm-editor) {
    height: auto;
}
.donote-editor.is-grow :deep(.cm-scroller) {
    overflow: visible;
}
</style>
