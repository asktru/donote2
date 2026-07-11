<script setup lang="ts">
import { AlarmClock, BellOff, Check, RotateCcw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MobileSidebarButton from '@/components/notes/MobileSidebarButton.vue';

import { Button } from '@/components/ui/button';
import { humanizeKey } from '@/core/dates';
import { reminderCandidates } from '@/core/reminders';
import type { ReminderCandidate } from '@/core/reminders';
import { cn } from '@/lib/utils';
import { openWorkspaceDb } from '@/stores/db';
import type { ReminderState, WorkspaceDb } from '@/stores/db';
import {
    liveNotes,
    parsedNote,
    toggleTaskLine,
    workspaceConfig,
} from '@/stores/workspace';

const emit = defineEmits<{
    'open-note': [noteId: string, line: number];
}>();

let db: WorkspaceDb | null = null;
const states = ref<Map<string, ReminderState>>(new Map());
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;

async function refreshStates(): Promise<void> {
    if (!db) {
        return;
    }

    const all = await db.reminders.toArray();
    states.value = new Map(all.map((entry) => [entry.key, entry]));
}

/** All open tasks with a reminder, soonest first. */
const rows = computed<ReminderCandidate[]>(() => {
    const candidates: ReminderCandidate[] = [];

    for (const note of liveNotes.value) {
        candidates.push(...reminderCandidates(note.id, parsedNote(note.id)));
    }

    return candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
});

type RowStatus =
    | { kind: 'pending' }
    | { kind: 'overdue' }
    | { kind: 'dismissed' }
    | { kind: 'snoozed'; until: number };

function statusOf(candidate: ReminderCandidate): RowStatus {
    const state = states.value.get(candidate.key);

    if (state?.status === 'dismissed') {
        return { kind: 'dismissed' };
    }

    if (
        state?.status === 'snoozed' &&
        state.until !== null &&
        state.until > now.value
    ) {
        return { kind: 'snoozed', until: state.until };
    }

    return candidate.at.getTime() <= now.value
        ? { kind: 'overdue' }
        : { kind: 'pending' };
}

function noteLabel(candidate: ReminderCandidate): string {
    const note = liveNotes.value.find((entry) => entry.id === candidate.noteId);

    if (!note) {
        return '';
    }

    if (note.type !== 'note' && note.dateKey !== null) {
        return humanizeKey(note.dateKey);
    }

    return note.title || 'Untitled';
}

function timeLabel(date: Date): string {
    const sameDay = new Date().toDateString() === date.toDateString();
    const time = date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });

    return sameDay
        ? time
        : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function snoozeLabel(candidate: ReminderCandidate): string | null {
    const status = statusOf(candidate);

    return status.kind === 'snoozed' ? timeLabel(new Date(status.until)) : null;
}

/** Clear the dismissed/snoozed state so the reminder can fire again. */
async function reset(candidate: ReminderCandidate): Promise<void> {
    await db?.reminders.delete(candidate.key);
    await refreshStates();
}

async function complete(candidate: ReminderCandidate): Promise<void> {
    await toggleTaskLine(candidate.noteId, candidate.line.index);
    await refreshStates();
}

onMounted(() => {
    const cfg = workspaceConfig();

    if (cfg) {
        db = openWorkspaceDb(cfg.teamSlug, cfg.userId);
    }

    void refreshStates();
    clock = setInterval(() => {
        now.value = Date.now();
        void refreshStates();
    }, 30000);
});

onBeforeUnmount(() => {
    if (clock !== null) {
        clearInterval(clock);
    }
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <header
            class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4"
        >
            <MobileSidebarButton />
            <AlarmClock class="size-4 text-muted-foreground" />
            <h1 class="text-base font-semibold">Reminders</h1>
            <span class="text-xs text-muted-foreground">{{ rows.length }}</span>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div
                v-if="rows.length === 0"
                class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
            >
                <BellOff class="size-8 opacity-40" />
                <p class="text-sm">
                    No reminders yet — add “@9am” to any task.
                </p>
            </div>

            <div
                v-for="candidate in rows"
                :key="candidate.key"
                class="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50"
            >
                <span
                    :class="
                        cn(
                            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                            statusOf(candidate).kind === 'overdue'
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-500'
                                : 'bg-primary/10 text-primary',
                        )
                    "
                >
                    <AlarmClock class="size-4" />
                </span>

                <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    @click="
                        emit(
                            'open-note',
                            candidate.noteId,
                            candidate.line.index,
                        )
                    "
                >
                    <p class="truncate text-sm">{{ candidate.line.title }}</p>
                    <p
                        class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                    >
                        <span
                            :class="
                                statusOf(candidate).kind === 'overdue' &&
                                'text-amber-600 dark:text-amber-500'
                            "
                        >
                            {{ timeLabel(candidate.at) }}
                        </span>
                        <span class="truncate">{{ noteLabel(candidate) }}</span>
                        <span
                            v-if="statusOf(candidate).kind === 'dismissed'"
                            class="rounded-full bg-muted px-1.5 text-[11px]"
                        >
                            dismissed
                        </span>
                        <span
                            v-else-if="snoozeLabel(candidate)"
                            class="rounded-full bg-muted px-1.5 text-[11px]"
                        >
                            snoozed until {{ snoozeLabel(candidate) }}
                        </span>
                    </p>
                </button>

                <div
                    class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100"
                >
                    <Button
                        v-if="
                            statusOf(candidate).kind !== 'pending' &&
                            statusOf(candidate).kind !== 'overdue'
                        "
                        variant="ghost"
                        size="sm"
                        class="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        title="Let it fire again"
                        @click="reset(candidate)"
                    >
                        <RotateCcw class="size-3.5" /> Restore
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-primary"
                        @click="complete(candidate)"
                    >
                        <Check class="size-3.5" /> Done
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>
