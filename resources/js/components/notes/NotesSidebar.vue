<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import {
    AlarmClock,
    Calendar,
    CalendarClock,
    CalendarDays,
    CalendarRange,
    Check,
    CheckCircle2,
    ChevronRight,
    FolderPlus,
    Keyboard,
    Layers,
    ListTodo,
    Pin,
    Plus,
    Search,
    Settings,
    Sun,
    Sparkles,
    Target,
} from '@lucide/vue';
import { computed, ref } from 'vue';

import FolderTree from '@/components/notes/FolderTree.vue';
import PieProgress from '@/components/notes/PieProgress.vue';
import RecordingsSection from '@/components/notes/RecordingsSection.vue';
import TagTree from '@/components/notes/TagTree.vue';
import TeamSwitcher from '@/components/TeamSwitcher.vue';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import UserInfo from '@/components/UserInfo.vue';
import UserMenuContent from '@/components/UserMenuContent.vue';
import { todayKey } from '@/core/dates';
import type { CalendarKind } from '@/core/dates';
import type { NoteKind } from '@/core/frontmatter';
import { isMacDesktopShell } from '@/lib/platform';
import { acceptTreeDrop, TREE_DND_MIME } from '@/lib/treeDnd';
import { cn } from '@/lib/utils';
import { syncStatus, pendingChanges } from '@/stores/sync';
import {
    currentView,
    openCalendar,
    openNote,
    openView,
    searchOpen,
    shortcutsOpen,
} from '@/stores/ui';
import type { MainView } from '@/stores/ui';
import {
    createFolder,
    createNote,
    folders,
    markReviewed,
    mentionCounts,
    noteMetaFor,
    noteProgressFor,
    pinnedNotes,
    regularNotes,
    reviewQueue,
    tagCounts,
} from '@/stores/workspace';

const REVIEW_ICONS: Record<NoteKind, typeof Target> = {
    project: Target,
    area: Layers,
    list: ListTodo,
    prompt: Sparkles,
};

const page = usePage();
const user = computed(() => page.props.auth.user);

const calendarSections: {
    kind: CalendarKind;
    label: string;
    icon: typeof Sun;
}[] = [
    { kind: 'daily', label: 'Daily', icon: Sun },
    { kind: 'weekly', label: 'Weekly', icon: CalendarDays },
    { kind: 'monthly', label: 'Monthly', icon: Calendar },
    { kind: 'quarterly', label: 'Quarterly', icon: CalendarRange },
    { kind: 'yearly', label: 'Yearly', icon: CalendarClock },
];

const tagsExpanded = ref(false);
const mentionsExpanded = ref(false);

const activeNoteId = computed(() =>
    currentView.value.kind === 'note' ? currentView.value.id : null,
);

const topTags = computed(() => [...tagCounts.value.entries()]);
const topMentions = computed(() => [...mentionCounts.value.entries()]);

function isCalendarActive(kind: CalendarKind): boolean {
    return (
        currentView.value.kind === 'calendar' &&
        currentView.value.calKind === kind
    );
}

function isActive(view: MainView['kind']): boolean {
    return currentView.value.kind === view;
}

async function newNote(): Promise<void> {
    const note = await createNote({ title: '' });
    openNote(note.id);
}

async function newFolder(): Promise<void> {
    const name = prompt('Folder name (use / for nesting):')?.trim();

    if (name) {
        await createFolder(name.replace(/^\/+|\/+$/g, ''));
    }
}

const rootDropTarget = ref(false);

async function onRootDrop(event: DragEvent): Promise<void> {
    rootDropTarget.value = false;
    const payload = event.dataTransfer?.getData(TREE_DND_MIME);

    if (payload) {
        await acceptTreeDrop(payload, '');
    }
}

const syncLabel = computed(() => {
    switch (syncStatus.value) {
        case 'offline':
            return 'Offline — changes saved locally';
        case 'syncing':
            return 'Syncing…';
        case 'error':
            return 'Sync error — will retry';
        default:
            return pendingChanges.value > 0
                ? `${pendingChanges.value} change(s) pending`
                : 'All changes synced';
    }
});
</script>

<template>
    <aside
        class="flex h-full w-64 shrink-0 flex-col border-r border-border/60 bg-muted/20"
    >
        <div
            v-if="isMacDesktopShell"
            class="app-region-drag h-7 shrink-0"
        />
        <div class="flex items-center gap-1 px-3 pt-3 pb-1">
            <TeamSwitcher in-header class="min-w-0 flex-1" />
            <Tooltip>
                <TooltipTrigger as-child>
                    <span
                        :class="
                            cn(
                                'ml-1 inline-block size-2 shrink-0 rounded-full',
                                syncStatus === 'synced' && 'bg-emerald-500',
                                syncStatus === 'syncing' &&
                                    'animate-pulse bg-amber-400',
                                syncStatus === 'offline' && 'bg-zinc-400',
                                syncStatus === 'error' && 'bg-red-500',
                            )
                        "
                    />
                </TooltipTrigger>
                <TooltipContent side="right">{{ syncLabel }}</TooltipContent>
            </Tooltip>
        </div>

        <button
            type="button"
            class="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-sm text-muted-foreground shadow-xs hover:bg-muted/50"
            @click="searchOpen = true"
        >
            <Search class="size-4" />
            <span>Search anything…</span>
            <kbd
                class="ml-auto rounded border border-border/70 px-1 font-sans text-[10px]"
                >⌘K</kbd
            >
        </button>

        <div class="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
            <section>
                <p
                    class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                    Calendar
                </p>
                <button
                    v-for="section in calendarSections"
                    :key="section.kind"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/70',
                            isCalendarActive(section.kind)
                                ? 'bg-muted font-medium text-primary'
                                : 'text-foreground/80',
                        )
                    "
                    @click="openCalendar(section.kind, todayKey(section.kind))"
                >
                    <component
                        :is="section.icon"
                        class="size-4 shrink-0 text-muted-foreground"
                    />
                    {{ section.label }}
                </button>
            </section>

            <section>
                <p
                    class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                    Views
                </p>
                <button
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/70',
                            isActive('tasks')
                                ? 'bg-muted font-medium text-primary'
                                : 'text-foreground/80',
                        )
                    "
                    @click="openView({ kind: 'tasks' })"
                >
                    <CheckCircle2
                        class="size-4 shrink-0 text-muted-foreground"
                    />
                    Tasks
                </button>
                <button
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/70',
                            isActive('reminders')
                                ? 'bg-muted font-medium text-primary'
                                : 'text-foreground/80',
                        )
                    "
                    @click="openView({ kind: 'reminders' })"
                >
                    <AlarmClock class="size-4 shrink-0 text-muted-foreground" />
                    Reminders
                </button>
            </section>

            <RecordingsSection />

            <section v-if="reviewQueue.length > 0">
                <p
                    class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-500"
                >
                    Review due · {{ reviewQueue.length }}
                </p>
                <div
                    v-for="note in reviewQueue"
                    :key="note.id"
                    class="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 hover:bg-muted/70"
                >
                    <component
                        :is="
                            noteMetaFor(note.id).type
                                ? REVIEW_ICONS[noteMetaFor(note.id).type!]
                                : CheckCircle2
                        "
                        class="size-4 shrink-0 text-muted-foreground"
                    />
                    <button
                        type="button"
                        class="min-w-0 flex-1 truncate text-left"
                        @click="openNote(note.id)"
                    >
                        {{ note.title || 'Untitled' }}
                    </button>
                    <PieProgress
                        v-if="noteProgressFor(note.id).total > 0"
                        :done="noteProgressFor(note.id).done"
                        :total="noteProgressFor(note.id).total"
                        :size="14"
                    />
                    <button
                        type="button"
                        class="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary"
                        title="Mark reviewed"
                        @click="markReviewed(note.id)"
                    >
                        <Check class="size-4" />
                    </button>
                </div>
            </section>

            <section v-if="pinnedNotes.length > 0">
                <p
                    class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                    Pinned
                </p>
                <button
                    v-for="note in pinnedNotes"
                    :key="note.id"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/70',
                            note.id === activeNoteId
                                ? 'bg-muted font-medium'
                                : 'text-foreground/80',
                        )
                    "
                    @click="openNote(note.id)"
                >
                    <Pin class="size-4 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ note.title || 'Untitled' }}</span>
                </button>
            </section>

            <section
                :class="
                    cn(
                        'rounded-md',
                        rootDropTarget && 'bg-primary/5 ring-1 ring-primary/40',
                    )
                "
                @dragover.prevent="rootDropTarget = true"
                @dragleave="rootDropTarget = false"
                @drop.prevent="onRootDrop"
            >
                <div class="flex items-center px-2 pb-1">
                    <p
                        class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                        Notes
                    </p>
                    <div class="ml-auto flex gap-0.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-5"
                            aria-label="New folder"
                            @click="newFolder"
                        >
                            <FolderPlus class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-5"
                            aria-label="New note"
                            @click="newNote"
                        >
                            <Plus class="size-3.5" />
                        </Button>
                    </div>
                </div>
                <FolderTree
                    path=""
                    :depth="0"
                    :folders="folders"
                    :notes="regularNotes"
                    :active-note-id="activeNoteId"
                    @open-note="(id, split) => openNote(id, { split })"
                />
            </section>

            <section v-if="topTags.length > 0">
                <button
                    type="button"
                    class="flex w-full items-center gap-1 px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                    @click="tagsExpanded = !tagsExpanded"
                >
                    <ChevronRight
                        :class="
                            cn(
                                'size-3 transition-transform',
                                tagsExpanded && 'rotate-90',
                            )
                        "
                    />
                    Tags ({{ topTags.length }})
                </button>
                <TagTree
                    v-if="tagsExpanded"
                    :counts="tagCounts"
                    sigil="#"
                    @open="(tag) => openView({ kind: 'tag', tag })"
                />
            </section>

            <section v-if="topMentions.length > 0">
                <button
                    type="button"
                    class="flex w-full items-center gap-1 px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                    @click="mentionsExpanded = !mentionsExpanded"
                >
                    <ChevronRight
                        :class="
                            cn(
                                'size-3 transition-transform',
                                mentionsExpanded && 'rotate-90',
                            )
                        "
                    />
                    Mentions ({{ topMentions.length }})
                </button>
                <TagTree
                    v-if="mentionsExpanded"
                    :counts="mentionCounts"
                    sigil="@"
                    @open="(mention) => openView({ kind: 'mention', mention })"
                />
            </section>
        </div>

        <div class="flex items-center gap-1 border-t border-border/60 p-2">
            <DropdownMenu>
                <DropdownMenuTrigger as-child>
                    <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/70"
                    >
                        <UserInfo :user="user" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent class="w-56" align="start" side="top">
                    <UserMenuContent :user="user" />
                </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
                <TooltipTrigger as-child>
                    <button
                        type="button"
                        class="rounded-md p-2 text-muted-foreground hover:bg-muted/70"
                        aria-label="Keyboard shortcuts"
                        @click="shortcutsOpen = true"
                    >
                        <Keyboard class="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top"
                    >Keyboard shortcuts (⌘/)</TooltipContent
                >
            </Tooltip>
            <Tooltip>
                <TooltipTrigger as-child>
                    <Link
                        href="/settings/integrations"
                        class="rounded-md p-2 text-muted-foreground hover:bg-muted/70"
                    >
                        <Settings class="size-4" />
                    </Link>
                </TooltipTrigger>
                <TooltipContent side="top"
                    >Settings & integrations</TooltipContent
                >
            </Tooltip>
        </div>
    </aside>
</template>
