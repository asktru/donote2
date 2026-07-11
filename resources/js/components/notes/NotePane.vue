<script setup lang="ts">
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Layers,
    ListTodo,
    Pin,
    PinOff,
    Target,
    Trash2,
    Waypoints,
    X,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import BacklinksSection from '@/components/notes/BacklinksSection.vue';
import PieProgress from '@/components/notes/PieProgress.vue';
import { Button } from '@/components/ui/button';
import { addPeriods, humanizeKey, todayKey } from '@/core/dates';
import { daysUntil, dueLabel, isReviewDue } from '@/core/frontmatter';
import type { NoteKind } from '@/core/frontmatter';
import { isMacDesktopShell } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { LocalNote } from '@/stores/db';
import type { PaneView } from '@/stores/ui';
import { openGraphView, pendingScrollLine } from '@/stores/ui';
import {
    deleteNote,
    findCalendarNote,
    getNote,
    markReviewed,
    materializeWikiTarget,
    noteMetaFor,
    noteProgressFor,
    openCalendarNote,
    renameNote,
    resolveWikiTarget,
    setNotePinned,
    updateNoteContent,
} from '@/stores/workspace';

const TYPE_ICONS: Record<NoteKind, typeof Target> = {
    project: Target,
    area: Layers,
    list: ListTodo,
};

const props = defineProps<{
    view: PaneView;
    isSplit?: boolean;
    isMain?: boolean;
}>();

const emit = defineEmits<{
    navigate: [view: PaneView];
    'open-note': [id: string, split: boolean];
    'open-calendar': [dateKey: string, split: boolean];
    'open-tag': [tag: string, split: boolean];
    'open-mention': [mention: string, split: boolean];
    'open-note-line': [id: string, line: number];
    close: [];
}>();

const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null);

watch(
    () => props.view,
    async (view) => {
        if (
            view.kind === 'calendar' &&
            !findCalendarNote(view.calKind, view.dateKey)
        ) {
            await openCalendarNote(view.calKind, view.dateKey);
        }

        if (props.isMain && pendingScrollLine.value !== null) {
            const line = pendingScrollLine.value;
            pendingScrollLine.value = null;
            setTimeout(() => editor.value?.scrollToLine(line), 50);
        }
    },
    { immediate: true, deep: true },
);

/**
 * The backing note, resolved reactively: calendar panes always follow the
 * canonical note of their period, even when sync replaces a locally created
 * placeholder with the server's copy.
 */
const note = computed<LocalNote | undefined>(() => {
    if (props.view.kind === 'note') {
        return getNote(props.view.id);
    }

    return findCalendarNote(props.view.calKind, props.view.dateKey);
});

const isCalendar = computed(() => props.view.kind === 'calendar');

const meta = computed(() => (note.value ? noteMetaFor(note.value.id) : null));

const progress = computed(() =>
    note.value ? noteProgressFor(note.value.id) : null,
);

const showsProgress = computed(
    () =>
        (meta.value?.type === 'project' || meta.value?.type === 'list') &&
        (progress.value?.total ?? 0) > 0,
);

const dueBadge = computed<{ label: string; tone: string } | null>(() => {
    if (meta.value?.type !== 'project' || meta.value.due === null) {
        return null;
    }

    const days = daysUntil(meta.value.due);
    const tone =
        days < 0
            ? 'bg-red-500/10 text-red-600 dark:text-red-500'
            : days <= 3
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
              : 'bg-muted text-muted-foreground';

    return { label: dueLabel(meta.value.due), tone };
});

const reviewIsDue = computed(
    () =>
        meta.value !== null &&
        meta.value.review !== null &&
        isReviewDue(meta.value),
);

async function markThisReviewed(): Promise<void> {
    if (note.value) {
        await markReviewed(note.value.id);
    }
}

const calendarTitle = computed(() =>
    props.view.kind === 'calendar' ? humanizeKey(props.view.dateKey) : '',
);

const isCurrentPeriod = computed(
    () =>
        props.view.kind === 'calendar' &&
        props.view.dateKey === todayKey(props.view.calKind),
);

function navigateCalendar(offset: number): void {
    if (props.view.kind !== 'calendar') {
        return;
    }

    const dateKey =
        offset === 0
            ? todayKey(props.view.calKind)
            : addPeriods(props.view.dateKey, offset);
    emit('navigate', {
        kind: 'calendar',
        calKind: props.view.calKind,
        dateKey,
    });
}

function onContentUpdate(content: string): void {
    if (note.value) {
        void updateNoteContent(note.value.id, content);
    }
}

function onTitleInput(event: Event): void {
    if (note.value) {
        void renameNote(
            note.value.id,
            (event.target as HTMLInputElement).value,
        );
    }
}

async function onOpenLink(target: string, split: boolean): Promise<void> {
    const resolved = resolveWikiTarget(target);

    if (resolved.calendarKey !== null) {
        emit('open-calendar', resolved.calendarKey, split);

        return;
    }

    const targetNote = resolved.note ?? (await materializeWikiTarget(target));
    emit('open-note', targetNote.id, split);
}

async function togglePin(): Promise<void> {
    if (note.value) {
        await setNotePinned(note.value.id, note.value.pinned === 0);
    }
}

async function trashNote(): Promise<void> {
    if (
        note.value &&
        confirm(`Move “${note.value.title || 'this note'}” to trash?`)
    ) {
        await deleteNote(note.value.id);
        emit('close');
    }
}

/** Focus the pane's editor (used by ⌘1/⌘2 pane switching). */
function focusEditor(): void {
    editor.value?.focus();
}

defineExpose({ focusEditor });
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <header
            :class="
                cn(
                    'flex h-12 shrink-0 items-center gap-1 border-b border-border/60 px-4',
                    isSplit && 'bg-muted/30',
                    isMacDesktopShell && 'app-region-drag',
                )
            "
        >
            <template v-if="isCalendar">
                <h1 class="truncate text-base font-semibold">
                    {{ calendarTitle }}
                </h1>
                <span
                    v-if="isCurrentPeriod"
                    class="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                    Today
                </span>
                <div class="ml-auto flex items-center gap-0.5">
                    <Button
                        v-if="note && !isSplit"
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        aria-label="Connections graph"
                        title="Connections graph (⌘⇧G)"
                        @click="openGraphView(note.id)"
                    >
                        <Waypoints class="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        aria-label="Previous"
                        @click="navigateCalendar(-1)"
                    >
                        <ChevronLeft class="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        :disabled="isCurrentPeriod"
                        @click="navigateCalendar(0)"
                    >
                        Today
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        aria-label="Next"
                        @click="navigateCalendar(1)"
                    >
                        <ChevronRight class="size-4" />
                    </Button>
                </div>
            </template>

            <template v-else>
                <input
                    :value="note?.title ?? ''"
                    class="w-full min-w-0 flex-1 truncate border-none bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground"
                    placeholder="Untitled"
                    @input="onTitleInput"
                />
                <div class="ml-auto flex items-center gap-1.5">
                    <component
                        :is="TYPE_ICONS[meta.type]"
                        v-if="meta?.type"
                        class="size-4 shrink-0 text-muted-foreground"
                        :aria-label="meta.type"
                    />
                    <PieProgress
                        v-if="showsProgress && progress"
                        :done="progress.done"
                        :total="progress.total"
                    />
                    <span
                        v-if="showsProgress && progress"
                        class="text-xs text-muted-foreground tabular-nums"
                    >
                        {{ progress.done }}/{{ progress.total }}
                    </span>
                    <span
                        v-if="dueBadge"
                        :class="
                            cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                                dueBadge.tone,
                            )
                        "
                    >
                        {{ dueBadge.label }}
                    </span>
                    <Button
                        v-if="meta?.review"
                        :variant="reviewIsDue ? 'secondary' : 'ghost'"
                        size="sm"
                        :class="
                            cn(
                                'h-7 gap-1 px-2 text-xs',
                                reviewIsDue
                                    ? 'text-amber-600 dark:text-amber-500'
                                    : 'text-muted-foreground',
                            )
                        "
                        :title="
                            reviewIsDue
                                ? 'Review is due — mark as reviewed today'
                                : `Reviewed ${meta.reviewed ?? 'never'} · repeats ${meta.review.raw}`
                        "
                        @click="markThisReviewed"
                    >
                        <Check class="size-3.5" />
                        {{ reviewIsDue ? 'Review due' : 'Reviewed' }}
                    </Button>
                    <span
                        v-if="note?.folder"
                        class="mr-1 hidden truncate text-xs text-muted-foreground lg:block"
                    >
                        {{ note.folder }}
                    </span>
                    <Button
                        v-if="note && !isSplit"
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        aria-label="Connections graph"
                        title="Connections graph (⌘⇧G)"
                        @click="openGraphView(note.id)"
                    >
                        <Waypoints class="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        :aria-label="note?.pinned ? 'Unpin' : 'Pin'"
                        @click="togglePin"
                    >
                        <PinOff v-if="note?.pinned" class="size-4" />
                        <Pin v-else class="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-7 text-muted-foreground hover:text-destructive"
                        aria-label="Delete note"
                        @click="trashNote"
                    >
                        <Trash2 class="size-4" />
                    </Button>
                </div>
            </template>

            <Button
                v-if="isSplit"
                variant="outline"
                size="sm"
                class="ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground"
                aria-label="Close split"
                title="Close split (Esc)"
                @click="emit('close')"
            >
                <X class="size-3.5" /> Close
            </Button>
        </header>

        <div class="min-h-0 flex-1 overflow-hidden px-4">
            <MarkdownEditor
                v-if="note"
                ref="editor"
                :key="note.id"
                :model-value="note.content"
                :state-key="note.id"
                :placeholder="'Type markdown, add a task (- [ ]), a checklist (+ [ ]), or link a note with [['"
                @update:model-value="onContentUpdate"
                @open-link="onOpenLink"
                @open-date="(key, split) => emit('open-calendar', key, split)"
                @open-tag="(tag, split) => emit('open-tag', tag, split)"
                @open-mention="
                    (mention, split) => emit('open-mention', mention, split)
                "
            />
        </div>

        <BacklinksSection
            :note-id="note?.id ?? null"
            @open-note="(id, line) => emit('open-note-line', id, line)"
        />
    </div>
</template>
