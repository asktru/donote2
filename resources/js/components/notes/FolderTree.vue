<script setup lang="ts">
import {
    Check,
    ChevronRight,
    Columns2,
    Copy,
    FilePlus,
    FileText,
    Folder,
    FolderInput,
    FolderPlus,
    Layers,
    ListTodo,
    Pencil,
    Pin,
    PinOff,
    Shapes,
    Sparkles,
    Target,
    Trash2,
} from '@lucide/vue';
import { computed, ref } from 'vue';

import PieProgress from '@/components/notes/PieProgress.vue';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { daysUntil, startsInFuture } from '@/core/frontmatter';
import type { NoteKind, NoteMeta } from '@/core/frontmatter';
import { isTemplateNote } from '@/lib/noteTemplates';
import { acceptTreeDrop, TREE_DND_MIME } from '@/lib/treeDnd';
import { cn } from '@/lib/utils';
import type { LocalNote } from '@/stores/db';
import { promptText } from '@/stores/prompt';
import { openTemplateDialog } from '@/stores/templateDialog';
import { expandedFolders, expandFolder, toggleFolder } from '@/stores/ui';
import {
    createFolder,
    createNote,
    deleteFolder,
    deleteFolderWithNotes,
    notesInFolderTree,
    deleteNote,
    duplicateNote,
    markReviewed,
    moveNoteToFolder,
    noteMetaFor,
    noteProgressFor,
    renameFolder,
    renameNote,
    setNotePinned,
    setNoteType,
} from '@/stores/workspace';

const props = defineProps<{
    path: string;
    depth: number;
    folders: string[];
    notes: LocalNote[];
    activeNoteId: string | null;
}>();

const emit = defineEmits<{
    'open-note': [id: string, split: boolean];
}>();

const expanded = computed(() => expandedFolders.value.has(props.path));
const dropTarget = ref(false);

const label = computed(() => props.path.split('/').pop() ?? props.path);

const childFolders = computed(() =>
    props.folders.filter((folder) => {
        if (props.path === '') {
            return !folder.includes('/');
        }

        return (
            folder.startsWith(`${props.path}/`) &&
            !folder.slice(props.path.length + 1).includes('/')
        );
    }),
);

const childNotes = computed(() =>
    props.notes
        .filter((note) => note.folder === props.path)
        .sort((a, b) => a.title.localeCompare(b.title)),
);

const childDepth = computed(() =>
    props.path === '' ? props.depth : props.depth + 1,
);

/* ------------------------- typed note chrome ------------------------ */

const NOTE_ICONS = {
    project: Target,
    area: Layers,
    list: ListTodo,
    prompt: Sparkles,
} as const;

function iconFor(meta: NoteMeta): typeof FileText {
    return meta.type !== null ? NOTE_ICONS[meta.type] : FileText;
}

/** Projects show a progress pie; lists show a plain incomplete count. */
function showsProgress(meta: NoteMeta): boolean {
    return meta.type === 'project';
}

/** Incomplete items in a list note, or null when it isn't a list / is empty. */
function listRemaining(meta: NoteMeta, id: string): number | null {
    if (meta.type !== 'list') {
        return null;
    }

    const { total, done } = noteProgressFor(id);

    return total > 0 ? total - done : null;
}

/** Compact Things-style due badge for the sidebar (14d / today / -3d). */
function shortDue(meta: NoteMeta): { label: string; tone: string } | null {
    if (meta.type !== 'project' || meta.due === null) {
        return null;
    }

    const days = daysUntil(meta.due);

    if (days < 0) {
        return { label: `${days}d`, tone: 'text-red-600 dark:text-red-500' };
    }

    if (days === 0) {
        return { label: 'today', tone: 'text-amber-600 dark:text-amber-500' };
    }

    if (days <= 3) {
        return {
            label: `${days}d`,
            tone: 'text-amber-600 dark:text-amber-500',
        };
    }

    return { label: `${days}d`, tone: 'text-muted-foreground' };
}

const TYPE_CHOICES: { kind: NoteKind | null; label: string }[] = [
    { kind: 'project', label: 'Project' },
    { kind: 'area', label: 'Area' },
    { kind: 'list', label: 'List' },
    { kind: 'prompt', label: 'AI prompt' },
    { kind: null, label: 'Plain note' },
];

/* ----------------------------- actions ----------------------------- */

async function newNoteHere(): Promise<void> {
    const note = await createNote({ title: '', folder: props.path });
    emit('open-note', note.id, false);
}

async function newSubfolder(): Promise<void> {
    const name = (
        await promptText({ title: 'New folder', placeholder: 'Folder name' })
    )?.replace(/\//g, '-');

    if (name) {
        await createFolder(props.path === '' ? name : `${props.path}/${name}`);
        expandFolder(props.path);
    }
}

async function renameThisFolder(): Promise<void> {
    const name = (
        await promptText({
            title: 'Rename folder',
            initialValue: label.value,
            confirmLabel: 'Rename',
        })
    )?.replace(/\//g, '-');

    if (!name || name === label.value) {
        return;
    }

    const parent = props.path.includes('/')
        ? props.path.slice(0, props.path.lastIndexOf('/'))
        : '';
    await renameFolder(props.path, parent === '' ? name : `${parent}/${name}`);
}

async function deleteThisFolder(): Promise<void> {
    if (
        confirm(`Delete folder “${label.value}”? Its notes move up one level.`)
    ) {
        await deleteFolder(props.path);
    }
}

async function deleteThisFolderWithNotes(): Promise<void> {
    const count = notesInFolderTree(props.path).length;
    const contents =
        count === 0
            ? 'It contains no notes.'
            : `Its ${count} note${count === 1 ? '' : 's'} move to trash.`;

    if (
        confirm(
            `Delete folder “${label.value}” and everything in it? ${contents}`,
        )
    ) {
        await deleteFolderWithNotes(props.path);
    }
}

async function renameNotePrompt(note: LocalNote): Promise<void> {
    const title = await promptText({
        title: 'Rename note',
        initialValue: note.title || 'Untitled',
        confirmLabel: 'Rename',
    });

    if (title !== null) {
        await renameNote(note.id, title);
    }
}

async function duplicateNoteAction(note: LocalNote): Promise<void> {
    const copy = await duplicateNote(note.id);

    if (copy) {
        emit('open-note', copy.id, false);
    }
}

async function deleteNotePrompt(note: LocalNote): Promise<void> {
    if (confirm(`Move “${note.title || 'this note'}” to trash?`)) {
        await deleteNote(note.id);
    }
}

/** Folders a note can be moved to (everything except its current one). */
function moveTargets(note: LocalNote): string[] {
    return props.folders.filter((folder) => folder !== note.folder);
}

/* ------------------------------ dnd -------------------------------- */

function onNoteDragStart(event: DragEvent, note: LocalNote): void {
    event.dataTransfer?.setData(TREE_DND_MIME, `note:${note.id}`);
    event.dataTransfer!.effectAllowed = 'move';
}

function onFolderDragStart(event: DragEvent): void {
    if (props.path === '') {
        return;
    }

    event.dataTransfer?.setData(TREE_DND_MIME, `folder:${props.path}`);
    event.dataTransfer!.effectAllowed = 'move';
    event.stopPropagation();
}

/**
 * A mouse drag leaves its source button focused, and a focused row matches
 * :focus-visible — so the browser's focus outline lingers after the drop.
 * The drag was a pointer gesture, not keyboard navigation, so drop the
 * focus once it ends.
 */
function onDragEnd(event: DragEvent): void {
    (event.currentTarget as HTMLElement | null)?.blur();
}

async function onDrop(event: DragEvent): Promise<void> {
    dropTarget.value = false;
    const payload = event.dataTransfer?.getData(TREE_DND_MIME);

    if (payload) {
        event.stopPropagation();
        await acceptTreeDrop(payload, props.path);
        expandFolder(props.path);
    }
}
</script>

<template>
    <div>
        <ContextMenu v-if="path !== ''">
            <ContextMenuTrigger as-child>
                <button
                    type="button"
                    draggable="true"
                    :class="
                        cn(
                            'group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-foreground/80 hover:bg-muted/70',
                            dropTarget &&
                                'bg-primary/10 ring-1 ring-primary/40',
                        )
                    "
                    :style="{ paddingLeft: `${depth * 14 + 8}px` }"
                    @click="toggleFolder(path)"
                    @dragstart="onFolderDragStart"
                    @dragover.prevent="dropTarget = true"
                    @dragleave="dropTarget = false"
                    @dragend="onDragEnd"
                    @drop.prevent="onDrop"
                >
                    <ChevronRight
                        :class="
                            cn(
                                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                expanded && 'rotate-90',
                            )
                        "
                    />
                    <Folder class="size-4 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ label }}</span>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem @select="newNoteHere">
                    <FilePlus /> New note
                </ContextMenuItem>
                <ContextMenuItem @select="newSubfolder">
                    <FolderPlus /> New subfolder…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem @select="renameThisFolder">
                    <Pencil /> Rename…
                </ContextMenuItem>
                <ContextMenuItem
                    variant="destructive"
                    @select="deleteThisFolder"
                >
                    <Trash2 /> Delete folder (keep notes)
                </ContextMenuItem>
                <ContextMenuItem
                    variant="destructive"
                    @select="deleteThisFolderWithNotes"
                >
                    <Trash2 /> Delete folder and notes…
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>

        <div v-if="expanded || path === ''">
            <FolderTree
                v-for="folder in childFolders"
                :key="folder"
                :path="folder"
                :depth="childDepth"
                :folders="folders"
                :notes="notes"
                :active-note-id="activeNoteId"
                @open-note="(id, split) => emit('open-note', id, split)"
            />

            <ContextMenu v-for="note in childNotes" :key="note.id">
                <ContextMenuTrigger as-child>
                    <button
                        type="button"
                        draggable="true"
                        :data-note-id="note.id"
                        :class="
                            cn(
                                'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-muted/70',
                                note.id === activeNoteId
                                    ? 'bg-muted font-medium text-foreground'
                                    : 'text-foreground/80',
                                startsInFuture(noteMetaFor(note.id)) &&
                                    'opacity-50',
                            )
                        "
                        :style="{
                            paddingLeft: `${childDepth * 14 + 8 + (path === '' ? 0 : 18)}px`,
                        }"
                        @click="emit('open-note', note.id, false)"
                        @dragstart="(event) => onNoteDragStart(event, note)"
                        @dragend="onDragEnd"
                    >
                        <component
                            :is="iconFor(noteMetaFor(note.id))"
                            class="size-4 shrink-0 text-muted-foreground"
                        />
                        <span class="truncate">{{
                            note.title || 'Untitled'
                        }}</span>
                        <span
                            class="ml-auto flex shrink-0 items-center gap-1.5"
                        >
                            <span
                                v-if="shortDue(noteMetaFor(note.id))"
                                :class="
                                    cn(
                                        'text-[11px] tabular-nums',
                                        shortDue(noteMetaFor(note.id))!.tone,
                                    )
                                "
                            >
                                {{ shortDue(noteMetaFor(note.id))!.label }}
                            </span>
                            <PieProgress
                                v-if="
                                    showsProgress(noteMetaFor(note.id)) &&
                                    noteProgressFor(note.id).total > 0
                                "
                                :done="noteProgressFor(note.id).done"
                                :total="noteProgressFor(note.id).total"
                                :size="14"
                            />
                            <span
                                v-else-if="
                                    listRemaining(noteMetaFor(note.id), note.id) !==
                                    null
                                "
                                class="text-[11px] tabular-nums text-muted-foreground"
                            >
                                {{ listRemaining(noteMetaFor(note.id), note.id) }}
                            </span>
                            <Pin
                                v-if="note.pinned === 1"
                                class="size-3 text-muted-foreground/60"
                            />
                        </span>
                    </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem
                        v-if="isTemplateNote(note)"
                        @select="openTemplateDialog(note.id)"
                    >
                        <FilePlus /> New note from template…
                    </ContextMenuItem>
                    <ContextMenuSeparator v-if="isTemplateNote(note)" />
                    <ContextMenuItem
                        @select="emit('open-note', note.id, false)"
                    >
                        <FileText /> Open
                    </ContextMenuItem>
                    <ContextMenuItem @select="emit('open-note', note.id, true)">
                        <Columns2 /> Open in split
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        v-if="noteMetaFor(note.id).review !== null"
                        @select="markReviewed(note.id)"
                    >
                        <Check /> Mark reviewed
                    </ContextMenuItem>
                    <ContextMenuItem
                        @select="setNotePinned(note.id, note.pinned === 0)"
                    >
                        <PinOff v-if="note.pinned === 1" />
                        <Pin v-else />
                        {{ note.pinned === 1 ? 'Unpin' : 'Pin' }}
                    </ContextMenuItem>
                    <ContextMenuItem @select="renameNotePrompt(note)">
                        <Pencil /> Rename…
                    </ContextMenuItem>
                    <ContextMenuItem @select="duplicateNoteAction(note)">
                        <Copy /> Duplicate
                    </ContextMenuItem>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <Shapes /> Turn into
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            <ContextMenuItem
                                v-for="choice in TYPE_CHOICES"
                                :key="choice.label"
                                @select="setNoteType(note.id, choice.kind)"
                            >
                                <component
                                    :is="
                                        choice.kind
                                            ? NOTE_ICONS[choice.kind]
                                            : FileText
                                    "
                                />
                                {{ choice.label }}
                                <Check
                                    v-if="
                                        noteMetaFor(note.id).type ===
                                        choice.kind
                                    "
                                    class="ml-auto"
                                />
                            </ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <FolderInput /> Move to
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            <ContextMenuItem
                                v-if="note.folder !== ''"
                                @select="moveNoteToFolder(note.id, '')"
                            >
                                Notes (top level)
                            </ContextMenuItem>
                            <ContextMenuItem
                                v-for="target in moveTargets(note)"
                                :key="target"
                                @select="moveNoteToFolder(note.id, target)"
                            >
                                {{ target }}
                            </ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        variant="destructive"
                        @select="deleteNotePrompt(note)"
                    >
                        <Trash2 /> Delete
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        </div>
    </div>
</template>
