<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import AiPromptDialog from '@/components/notes/AiPromptDialog.vue';
import DueTasksSection from '@/components/notes/DueTasksSection.vue';
import EditorToolbar from '@/components/notes/EditorToolbar.vue';
import EventsList from '@/components/notes/EventsList.vue';
import FilePreview from '@/components/notes/FilePreview.vue';
import GraphView from '@/components/notes/GraphView.vue';
import ImageLightbox from '@/components/notes/ImageLightbox.vue';
import MiniCalendar from '@/components/notes/MiniCalendar.vue';
import NotePane from '@/components/notes/NotePane.vue';
import NotesSidebar from '@/components/notes/NotesSidebar.vue';
import PromptDialog from '@/components/notes/PromptDialog.vue';
import QuickCaptureFab from '@/components/notes/QuickCaptureFab.vue';
import ReminderHost from '@/components/notes/ReminderHost.vue';
import RemindersView from '@/components/notes/RemindersView.vue';
import SearchDialog from '@/components/notes/SearchDialog.vue';
import ShortcutsDialog from '@/components/notes/ShortcutsDialog.vue';
import SyncedLineLocations from '@/components/notes/SyncedLineLocations.vue';
import TasksView from '@/components/notes/TasksView.vue';
import TrashView from '@/components/notes/TrashView.vue';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { hideNativeAccessoryBar } from '@/composables/useKeyboardInset';
import { useSwipe } from '@/composables/useSwipe';
import { kindOfKey, todayDailyKey, todayKey } from '@/core/dates';
import type { CalendarKind } from '@/core/dates';
import { isMacDesktopShell, isNarrowViewport } from '@/lib/platform';
import { resolveSwipeAction } from '@/lib/swipeActions';
import { aiDialogOpen } from '@/stores/aiPrompts';
import {
    startMemoUploader,
    stopMemoUploader,
    toggleRecording,
} from '@/stores/memos';
import { promptText } from '@/stores/prompt';
import { startSync, stopSync } from '@/stores/sync';
import {
    closeSplit,
    collapseAllFolders,
    currentView,
    expandFolderPath,
    initViewFromUrl,
    mobileSidebarOpen,
    openCalendar,
    openGraphView,
    openMentionView,
    openNote,
    openTagView,
    openView,
    searchOpen,
    shortcutsOpen,
    splitView,
    stepCalendar,
} from '@/stores/ui';
import {
    createFolder,
    createNote,
    findCalendarNote,
    getNote,
    initWorkspace,
    workspaceReady,
} from '@/stores/workspace';

const props = defineProps<{
    workspace: {
        teamSlug: string;
        teamName: string;
        userId: number;
    };
    googleConnected: boolean;
}>();

const ready = workspaceReady();
const booted = ref(false);
const mainPane = ref<InstanceType<typeof NotePane> | null>(null);
const splitPane = ref<InstanceType<typeof NotePane> | null>(null);

function handleOpenCalendar(dateKey: string, split = false): void {
    const kind = kindOfKey(dateKey);

    if (kind !== null) {
        openCalendar(kind, dateKey, { split });
    }
}

function handleOpenNote(id: string, split = false, line?: number): void {
    openNote(id, { split, line });
}

const mainNoteExists = computed(() => {
    const view = currentView.value;

    return view.kind !== 'note' || getNote(view.id) !== undefined;
});

/** The note backing the main pane, if any. */
function currentMainNoteId(): string | null {
    const view = currentView.value;

    if (view.kind === 'note') {
        return view.id;
    }

    if (view.kind === 'calendar') {
        return findCalendarNote(view.calKind, view.dateKey)?.id ?? null;
    }

    return null;
}

/** The folder new notes/folders should land in (current note's folder). */
function currentFolder(): string {
    const view = currentView.value;

    if (view.kind === 'note') {
        return getNote(view.id)?.folder ?? '';
    }

    return '';
}

async function createNoteHere(): Promise<void> {
    const note = await createNote({ title: '', folder: currentFolder() });
    openNote(note.id);
}

async function createFolderHere(): Promise<void> {
    const name = (
        await promptText({
            title: 'New folder',
            placeholder: 'Folder name',
        })
    )?.replace(/\//g, '-');

    if (name) {
        const parent = currentFolder();
        await createFolder(parent === '' ? name : `${parent}/${name}`);
    }
}

/** Expand the current note's ancestors and flash it in the sidebar. */
async function revealCurrentNote(): Promise<void> {
    const noteId = currentMainNoteId();
    const note = noteId !== null ? getNote(noteId) : undefined;

    if (!note || note.type !== 'note') {
        return;
    }

    if (window.innerWidth < 768) {
        mobileSidebarOpen.value = true;
    }

    if (note.folder !== '') {
        expandFolderPath(note.folder);
    }

    await nextTick();
    setTimeout(() => {
        const candidates = [
            ...document.querySelectorAll<HTMLElement>(
                `[data-note-id="${note.id}"]`,
            ),
        ];
        const visible = candidates.find((el) => el.offsetParent !== null);

        if (visible) {
            visible.scrollIntoView({ block: 'center' });
            visible.classList.add('sidebar-reveal-flash');
            setTimeout(
                () => visible.classList.remove('sidebar-reveal-flash'),
                1200,
            );
        }
    }, 80);
}

function onKeydown(event: KeyboardEvent): void {
    // Esc closes the split pane — unless something closer to the user
    // (a dialog, menu, or the editor's autocomplete) already consumed it.
    if (event.key === 'Escape') {
        if (
            event.defaultPrevented ||
            searchOpen.value ||
            shortcutsOpen.value ||
            document.querySelector(
                '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
            ) !== null
        ) {
            return;
        }

        if (splitView.value !== null) {
            event.preventDefault();
            closeSplit();
        }

        return;
    }

    // Start/stop voice recording: ⌘⇧R in the desktop shell (Reflect
    // parity), ⌃⌥R in browsers where ⌘⇧R means hard reload.
    if (
        event.code === 'KeyR' &&
        ((isMacDesktopShell && event.metaKey && event.shiftKey) ||
            (event.ctrlKey && event.altKey))
    ) {
        event.preventDefault();
        void toggleRecording();

        return;
    }

    // ⌃S (NotePlan parity): reveal the current note in the sidebar.
    if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === 'KeyS'
    ) {
        event.preventDefault();
        void revealCurrentNote();

        return;
    }

    const modifier = event.metaKey || event.ctrlKey;

    if (!modifier) {
        return;
    }

    const key = event.key.toLowerCase();
    const calendarKinds: CalendarKind[] = [
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
    ];

    if (key === 'k') {
        event.preventDefault();
        searchOpen.value = !searchOpen.value;
    } else if (key === 'j' && !event.shiftKey) {
        event.preventDefault();
        aiDialogOpen.value = !aiDialogOpen.value;
    } else if (key === 't' && !event.shiftKey) {
        event.preventDefault();
        openCalendar('daily', todayDailyKey());
    } else if (event.altKey && event.code === 'Slash') {
        // ⌘⌥/ (NotePlan parity): collapse every sidebar folder.
        event.preventDefault();
        collapseAllFolders();
    } else if (event.key === '/') {
        event.preventDefault();
        shortcutsOpen.value = !shortcutsOpen.value;
    } else if (key === 'n') {
        event.preventDefault();

        if (event.shiftKey) {
            void createFolderHere();
        } else {
            void createNoteHere();
        }
    } else if (key === 'g' && event.shiftKey) {
        event.preventDefault();
        const noteId = currentMainNoteId();

        if (noteId !== null) {
            openGraphView(noteId);
        }
    } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        mainPane.value?.focusEditor();
    } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        splitPane.value?.focusEditor();
    } else if (
        !event.shiftKey &&
        !event.altKey &&
        ['1', '2', '3', '4', '5'].includes(event.key)
    ) {
        event.preventDefault();
        const kind = calendarKinds[Number(event.key) - 1];
        openCalendar(kind, todayKey(kind));
    }
}

// Touch gestures (phones): edge-swipe opens the menu, a swipe over a
// calendar note steps to the next/previous period.
useSwipe((swipe) => {
    const target = swipe.target;
    const action = resolveSwipeAction(swipe, {
        menuOpen: mobileSidebarOpen.value,
        hasSplit: splitView.value !== null,
        isCalendar: currentView.value.kind === 'calendar',
        narrow: isNarrowViewport(),
        startedInPane:
            target instanceof Element &&
            target.closest('[data-swipe-pane]') != null,
    });

    if (action === 'open-menu') {
        mobileSidebarOpen.value = true;
    } else if (action === 'close-menu') {
        mobileSidebarOpen.value = false;
    } else if (action === 'calendar-next') {
        stepCalendar(1);
    } else if (action === 'calendar-prev') {
        stepCalendar(-1);
    }
});

onMounted(async () => {
    await initWorkspace({
        teamSlug: props.workspace.teamSlug,
        userId: props.workspace.userId,
    });
    initViewFromUrl();
    booted.value = true;
    window.addEventListener('keydown', onKeydown);
    void hideNativeAccessoryBar();
    startMemoUploader();
    await startSync();
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    stopMemoUploader();
    stopSync();
});
</script>

<template>
    <Head :title="`Notes · ${workspace.teamName}`" />

    <TooltipProvider :delay-duration="300">
        <div
            class="flex h-dvh w-full overflow-hidden bg-background text-foreground pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        >
            <template v-if="ready && booted">
                <div class="hidden h-full shrink-0 md:flex">
                    <NotesSidebar />
                </div>

                <Sheet v-model:open="mobileSidebarOpen">
                    <SheetContent
                        side="left"
                        class="w-64 gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
                    >
                        <SheetTitle class="sr-only">Navigation</SheetTitle>
                        <NotesSidebar />
                    </SheetContent>
                </Sheet>

                <main
                    class="relative flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row"
                >
                    <QuickCaptureFab />
                    <div
                        data-swipe-pane
                        class="flex min-h-0 min-w-0 flex-1 basis-1/2 flex-col border-b border-border/40 lg:border-r lg:border-b-0"
                    >
                        <TasksView
                            v-if="currentView.kind === 'tasks'"
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                        />
                        <RemindersView
                            v-else-if="currentView.kind === 'reminders'"
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                        />
                        <TrashView
                            v-else-if="currentView.kind === 'trash'"
                            @open-note="(id) => handleOpenNote(id)"
                        />
                        <TasksView
                            v-else-if="currentView.kind === 'tag'"
                            :key="`tag:${currentView.tag}`"
                            :filter-tag="currentView.tag"
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                        />
                        <TasksView
                            v-else-if="currentView.kind === 'mention'"
                            :key="`mention:${currentView.mention}`"
                            :filter-mention="currentView.mention"
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                        />
                        <NotePane
                            v-else-if="mainNoteExists"
                            ref="mainPane"
                            :view="currentView"
                            is-main
                            @navigate="(view) => openView(view)"
                            @open-note="
                                (id, split) => handleOpenNote(id, split)
                            "
                            @open-calendar="
                                (key, split) => handleOpenCalendar(key, split)
                            "
                            @open-tag="(tag, split) => openTagView(tag, split)"
                            @open-mention="
                                (mention, split) =>
                                    openMentionView(mention, split)
                            "
                            @open-note-line="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                            @close="openCalendar('daily', todayDailyKey())"
                        />
                        <div
                            v-else
                            class="flex h-full items-center justify-center text-sm text-muted-foreground"
                        >
                            This note no longer exists.
                        </div>
                    </div>

                    <div
                        v-if="splitView"
                        class="flex min-h-0 min-w-0 flex-1 basis-1/2 flex-col border-border/40 lg:border-r"
                    >
                        <GraphView
                            v-if="splitView.kind === 'graph'"
                            :key="`graph:${splitView.noteId}`"
                            :note-id="splitView.noteId"
                            @open-note="(id) => handleOpenNote(id)"
                            @open-tag="(tag) => openTagView(tag)"
                            @open-mention="
                                (mention) => openMentionView(mention)
                            "
                            @close="closeSplit"
                        />
                        <TasksView
                            v-else-if="splitView.kind === 'tag'"
                            :key="`split-tag:${splitView.tag}`"
                            :filter-tag="splitView.tag"
                            is-split
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                            @close="closeSplit"
                        />
                        <TasksView
                            v-else-if="splitView.kind === 'mention'"
                            :key="`split-mention:${splitView.mention}`"
                            :filter-mention="splitView.mention"
                            is-split
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                            @close="closeSplit"
                        />
                        <NotePane
                            v-else
                            ref="splitPane"
                            :view="splitView"
                            is-split
                            @navigate="(view) => (splitView = view)"
                            @open-note="
                                (id, split) => handleOpenNote(id, split)
                            "
                            @open-calendar="
                                (key, split) => handleOpenCalendar(key, split)
                            "
                            @open-tag="(tag, split) => openTagView(tag, split)"
                            @open-mention="
                                (mention, split) =>
                                    openMentionView(mention, split)
                            "
                            @open-note-line="
                                (id, line) => handleOpenNote(id, false, line)
                            "
                            @close="closeSplit"
                        />
                    </div>
                </main>

                <!-- Splits reclaim the calendar sidebar's width. -->
                <aside
                    v-if="splitView === null"
                    class="hidden h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border/60 bg-muted/20 p-4 xl:flex"
                >
                    <MiniCalendar
                        @pick-day="(key) => handleOpenCalendar(key)"
                        @pick-week="(key) => handleOpenCalendar(key)"
                        @pick-period="(key) => handleOpenCalendar(key)"
                    />
                    <EventsList :google-connected="googleConnected" />
                    <DueTasksSection
                        @open-note="(id, line) => handleOpenNote(id, false, line)"
                    />
                </aside>

                <SearchDialog
                    @open-note="(id) => handleOpenNote(id)"
                    @open-calendar="(key) => handleOpenCalendar(key)"
                />
                <ShortcutsDialog />
                <AiPromptDialog />
                <ImageLightbox />
                <FilePreview />
                <SyncedLineLocations />
                <PromptDialog />
                <EditorToolbar />
                <ReminderHost
                    @open-note="(id, line) => handleOpenNote(id, false, line)"
                />
            </template>

            <div v-else class="flex h-full w-full items-center justify-center">
                <div
                    class="flex flex-col items-center gap-3 text-muted-foreground"
                >
                    <div
                        class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
                    ></div>
                    <p class="text-sm">Opening your workspace…</p>
                </div>
            </div>

            <Toaster />
        </div>
    </TooltipProvider>
</template>
