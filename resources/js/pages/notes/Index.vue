<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import EventsList from '@/components/notes/EventsList.vue';
import MiniCalendar from '@/components/notes/MiniCalendar.vue';
import NotePane from '@/components/notes/NotePane.vue';
import NotesSidebar from '@/components/notes/NotesSidebar.vue';
import ReminderHost from '@/components/notes/ReminderHost.vue';
import SearchDialog from '@/components/notes/SearchDialog.vue';
import ShortcutsDialog from '@/components/notes/ShortcutsDialog.vue';
import TasksView from '@/components/notes/TasksView.vue';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { kindOfKey, todayDailyKey } from '@/core/dates';
import { startSync, stopSync } from '@/stores/sync';
import {
    closeSplit,
    currentView,
    initViewFromUrl,
    openCalendar,
    openMentionView,
    openNote,
    openTagView,
    openView,
    searchOpen,
    shortcutsOpen,
    splitView,
} from '@/stores/ui';
import { getNote, initWorkspace, workspaceReady } from '@/stores/workspace';

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

function onKeydown(event: KeyboardEvent): void {
    const modifier = event.metaKey || event.ctrlKey;

    if (!modifier) {
        return;
    }

    if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchOpen.value = !searchOpen.value;
    } else if (event.key.toLowerCase() === 't' && !event.shiftKey) {
        event.preventDefault();
        openCalendar('daily', todayDailyKey());
    } else if (event.key === '\\') {
        event.preventDefault();

        if (splitView.value !== null) {
            closeSplit();
        }
    } else if (event.key === '/') {
        event.preventDefault();
        shortcutsOpen.value = !shortcutsOpen.value;
    } else if (event.key === '1') {
        event.preventDefault();
        mainPane.value?.focusEditor();
    } else if (event.key === '2' && splitView.value !== null) {
        event.preventDefault();
        splitPane.value?.focusEditor();
    }
}

onMounted(async () => {
    await initWorkspace({
        teamSlug: props.workspace.teamSlug,
        userId: props.workspace.userId,
    });
    initViewFromUrl();
    booted.value = true;
    window.addEventListener('keydown', onKeydown);
    await startSync();
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    stopSync();
});
</script>

<template>
    <Head :title="`Notes · ${workspace.teamName}`" />

    <TooltipProvider :delay-duration="300">
        <div
            class="flex h-screen w-full overflow-hidden bg-background text-foreground"
        >
            <template v-if="ready && booted">
                <NotesSidebar />

                <main class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
                    <div
                        class="flex min-h-0 min-w-0 flex-1 basis-1/2 flex-col border-b border-border/40 lg:border-r lg:border-b-0"
                    >
                        <TasksView
                            v-if="currentView.kind === 'tasks'"
                            @open-note="
                                (id, line) => handleOpenNote(id, false, line)
                            "
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
                        <TasksView
                            v-if="splitView.kind === 'tag'"
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

                <aside
                    class="hidden h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border/60 bg-muted/20 p-4 xl:flex"
                >
                    <MiniCalendar
                        @pick-day="(key) => handleOpenCalendar(key)"
                        @pick-week="(key) => handleOpenCalendar(key)"
                    />
                    <EventsList :google-connected="googleConnected" />
                </aside>

                <SearchDialog @open-note="(id) => handleOpenNote(id)" />
                <ShortcutsDialog />
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
