<script setup lang="ts">
import { AlarmClock, Check, ExternalLink } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { Button } from '@/components/ui/button';
import { formatReminderToken, reminderCandidates } from '@/core/reminders';
import type { ReminderCandidate } from '@/core/reminders';
import {
    notificationId,
    reconcileNotifications,
} from '@/lib/notifications';
import type { DesiredNotification } from '@/lib/notifications';
import { openWorkspaceDb } from '@/stores/db';
import type { WorkspaceDb } from '@/stores/db';
import {
    workspaceConfig,
    liveNotes,
    parsedNote,
    rewriteReminderToken,
    toggleTaskLine,
} from '@/stores/workspace';

const emit = defineEmits<{
    'open-note': [noteId: string, line: number];
}>();

const active = ref<ReminderCandidate[]>([]);

let db: WorkspaceDb | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function scan(): Promise<void> {
    if (!db) {
        return;
    }

    const now = Date.now();
    const candidates: ReminderCandidate[] = [];
    const noteTitles = new Map<string, string>();

    for (const note of liveNotes.value) {
        noteTitles.set(note.id, note.title);
        candidates.push(...reminderCandidates(note.id, parsedNote(note.id)));
    }

    const desired: DesiredNotification[] = [];

    for (const candidate of candidates) {
        const fireAt = candidate.at.getTime();
        const state = await db.reminders.get(candidate.key);
        const silenced =
            state?.status === 'dismissed' ||
            (state?.status === 'snoozed' &&
                state.until !== null &&
                state.until > now);

        // Future reminders become on-device OS notifications; a completed or
        // rescheduled task drops its candidate, so it's cancelled on reconcile.
        if (fireAt > now && !silenced) {
            desired.push({
                id: notificationId(candidate.key),
                at: fireAt,
                title: candidate.line.title || 'Reminder',
                body: noteTitles.get(candidate.noteId) || 'Task reminder',
            });
        }

        // Fire reminders due within the last 12 hours (missed while away) up to now.
        if (fireAt > now || now - fireAt > 12 * 3600 * 1000) {
            continue;
        }

        if (active.value.some((entry) => entry.key === candidate.key)) {
            continue;
        }

        if (silenced) {
            continue;
        }

        active.value = [...active.value, candidate];
    }

    void reconcileNotifications(desired);
}

async function dismiss(candidate: ReminderCandidate): Promise<void> {
    active.value = active.value.filter((entry) => entry.key !== candidate.key);
    await db?.reminders.put({
        key: candidate.key,
        status: 'dismissed',
        until: null,
    });
}

async function snooze(
    candidate: ReminderCandidate,
    minutes: number | 'tomorrow',
): Promise<void> {
    active.value = active.value.filter((entry) => entry.key !== candidate.key);

    if (minutes === 'tomorrow') {
        await db?.reminders.put({
            key: candidate.key,
            status: 'snoozed',
            until: new Date(new Date().setHours(24 + 9, 0, 0, 0)).getTime(),
        });

        return;
    }

    // Rewrite the @time token in the note so the snooze is visible and the
    // reminder re-fires at the new time (which yields a fresh key).
    const at = new Date(Date.now() + minutes * 60000);
    const rewritten =
        candidate.line.reminderRaw !== null &&
        (await rewriteReminderToken(
            candidate.noteId,
            candidate.line,
            candidate.line.reminderRaw,
            formatReminderToken(at),
        ));

    // Silence the old firing; fall back to a plain snooze if the line moved.
    await db?.reminders.put(
        rewritten
            ? { key: candidate.key, status: 'dismissed', until: null }
            : {
                  key: candidate.key,
                  status: 'snoozed',
                  until: at.getTime(),
              },
    );
}

async function complete(candidate: ReminderCandidate): Promise<void> {
    await toggleTaskLine(candidate.noteId, candidate.line.index);
    await dismiss(candidate);
}

function openNote(candidate: ReminderCandidate): void {
    emit('open-note', candidate.noteId, candidate.line.index);
    void dismiss(candidate);
}

onMounted(() => {
    const cfg = workspaceConfig();

    if (cfg) {
        db = openWorkspaceDb(cfg.teamSlug, cfg.userId);
    }

    void scan();
    timer = setInterval(() => void scan(), 30000);
});

onBeforeUnmount(() => {
    if (timer !== null) {
        clearInterval(timer);
    }
});
</script>

<template>
    <Teleport to="body">
        <div
            v-if="active.length > 0"
            class="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
        >
            <div
                v-for="candidate in active"
                :key="candidate.key"
                class="rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
            >
                <div class="flex items-start gap-2">
                    <span
                        class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                    >
                        <AlarmClock class="size-4" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium">
                            {{ candidate.line.title }}
                        </p>
                        <p class="text-xs text-muted-foreground">
                            {{
                                candidate.at.toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                })
                            }}
                        </p>
                    </div>
                </div>

                <div class="mt-2.5 flex flex-wrap items-center gap-1">
                    <Button
                        size="sm"
                        class="h-7 gap-1 px-2 text-xs"
                        @click="complete(candidate)"
                    >
                        <Check class="size-3.5" /> Done
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        class="h-7 gap-1 px-2 text-xs"
                        @click="openNote(candidate)"
                    >
                        <ExternalLink class="size-3.5" /> Open
                    </Button>
                    <div class="ml-auto flex gap-0.5">
                        <Button
                            size="sm"
                            variant="ghost"
                            class="h-7 px-1.5 text-xs text-muted-foreground"
                            @click="snooze(candidate, 5)"
                            >5m</Button
                        >
                        <Button
                            size="sm"
                            variant="ghost"
                            class="h-7 px-1.5 text-xs text-muted-foreground"
                            @click="snooze(candidate, 30)"
                            >30m</Button
                        >
                        <Button
                            size="sm"
                            variant="ghost"
                            class="h-7 px-1.5 text-xs text-muted-foreground"
                            @click="snooze(candidate, 60)"
                            >1h</Button
                        >
                        <Button
                            size="sm"
                            variant="ghost"
                            class="h-7 px-1.5 text-xs text-muted-foreground"
                            @click="snooze(candidate, 'tomorrow')"
                            >Tmrw</Button
                        >
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
