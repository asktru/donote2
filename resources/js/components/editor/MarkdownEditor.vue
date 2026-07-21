<script setup lang="ts">
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder as placeholderExt } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
    applyPersistedFolds,
    donoteMarkdown,
    viewModeFacet,
} from '@/components/editor/markdownExtensions';
import { attachmentHandlers } from '@/lib/attachments';
import { recallCursor, rememberCursor } from '@/lib/cursorMemory';
import {
    blurEditor,
    bumpEditorTick,
    focusEditor,
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
    /** Make the note non-editable (a read-only share, or offline write). */
    readOnly?: boolean;
    /**
     * User read-only mode (`mode: read-only`): block text editing and never
     * reveal raw markdown, but keep the note interactive — task/checklist
     * toggles, folds, and links still work, and their changes persist.
     */
    viewMode?: boolean;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
    'open-link': [target: string, split: boolean, newWindow?: boolean];
    'open-date': [dateKey: string, split: boolean];
    'open-tag': [tag: string, split: boolean];
    'open-mention': [mention: string, split: boolean];
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
/** Guards against feeding our own emitted updates back into the editor. */
let lastEmitted: string | null = null;
/** Lets us toggle read-only without rebuilding the whole editor state. */
const readOnlyCompartment = new Compartment();

/**
 * Two flavours of non-editable:
 * - `readOnly` (a read-only share, or an offline write) fully locks the
 *   editor: no typing AND no programmatic edits accepted.
 * - `viewMode` (`mode: read-only`) blocks typing and mark-revealing but
 *   leaves the note interactive — checkbox/fold/link dispatches still apply
 *   (only `EditorView.editable` is off, not `EditorState.readOnly`).
 * Either flavour suppresses reveal-on-cursor via the viewMode facet.
 */
function readOnlyExtension(readOnly: boolean, viewMode: boolean) {
    const nonEditable = readOnly || viewMode;

    return [
        viewModeFacet.of(nonEditable),
        ...(nonEditable ? [EditorView.editable.of(false)] : []),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ];
}

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
                    onOpenLink: (target, split, newWindow) =>
                        emit('open-link', target, split, newWindow),
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
                readOnlyCompartment.of(
                    readOnlyExtension(
                        props.readOnly ?? false,
                        props.viewMode ?? false,
                    ),
                ),
                attachmentHandlers(() => props.stateKey),
                EditorView.domEventHandlers({
                    focus: (_event, focusedView) =>
                        focusEditor(focusedView, props.stateKey),
                    blur: (_event, blurredView) => blurEditor(blurredView),
                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        lastEmitted = update.state.doc.toString();
                        emit('update:modelValue', lastEmitted);
                    }

                    if (update.selectionSet || update.docChanged) {
                        // Let the mobile toolbar recompute against the line
                        // the cursor is now on.
                        bumpEditorTick();

                        if (props.stateKey) {
                            rememberCursor(
                                props.stateKey,
                                update.state.selection.main.head,
                            );
                        }
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

watch(
    () => [props.readOnly, props.viewMode],
    ([readOnly, viewMode]) => {
        view?.dispatch({
            effects: readOnlyCompartment.reconfigure(
                readOnlyExtension(readOnly ?? false, viewMode ?? false),
            ),
        });
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
        registerEditor(view, props.stateKey);
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
