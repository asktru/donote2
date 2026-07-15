<script setup lang="ts">
import { Video, X } from '@lucide/vue';
import {
    addDays,
    differenceInMinutes,
    format,
    parseISO,
    startOfDay,
} from 'date-fns';
import { computed, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    calendarList,
    closeEventEditor,
    createEvent,
    eventDraft,
    fetchInviteeBusy,
} from '@/stores/calendar';
import type { BusyInterval } from '@/stores/calendar';
import { teamMembers } from '@/stores/team';

/** Availability strip window: 6:00–22:00. */
const DAY_START_MIN = 6 * 60;
const DAY_WINDOW_MIN = 16 * 60;

const open = computed({
    get: () => eventDraft.value !== null,
    set: (value) => {
        if (!value) {
            closeEventEditor();
        }
    },
});

/** Timeblocks are a minimal form (no invitees / availability / Meet). */
const isMeeting = computed(() => eventDraft.value?.kind !== 'timeblock');

const summary = ref('');
const location = ref('');
const description = ref('');
const allDay = ref(false);
const startLocal = ref('');
const endLocal = ref('');
const startDate = ref('');
const endDate = ref('');
const calendarId = ref('');
const attendees = ref<string[]>([]);
const inviteeInput = ref('');
const addMeet = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const googleCalendars = computed(() =>
    calendarList.value.filter((calendar) => calendar.source === 'google'),
);

const nameByEmail = computed(() => {
    const map = new Map<string, string>();

    for (const member of teamMembers.value) {
        if (member.email) {
            map.set(member.email, member.name);
        }
    }

    return map;
});

const otherColleagues = computed(() =>
    teamMembers.value.filter(
        (member) =>
            member.email &&
            !attendees.value.includes(member.email),
    ),
);

// Initialize the form each time the editor opens.
watch(eventDraft, (draft) => {
    if (draft === null) {
        return;
    }

    summary.value = '';
    location.value = '';
    description.value = '';
    allDay.value = false;
    startLocal.value = format(draft.start, "yyyy-MM-dd'T'HH:mm");
    endLocal.value = format(draft.end, "yyyy-MM-dd'T'HH:mm");
    startDate.value = format(draft.start, 'yyyy-MM-dd');
    endDate.value = format(draft.start, 'yyyy-MM-dd');
    calendarId.value = googleCalendars.value[0]?.id ?? '';
    attendees.value = [...draft.attendees];
    addMeet.value = draft.attendees.length > 0;
    error.value = null;
});

function addInvitee(email: string): void {
    const trimmed = email.trim().toLowerCase();

    if (trimmed && !attendees.value.includes(trimmed)) {
        attendees.value = [...attendees.value, trimmed];
    }

    inviteeInput.value = '';
}

function removeInvitee(email: string): void {
    attendees.value = attendees.value.filter((entry) => entry !== email);
}

/* ---- Availability strip -------------------------------------------- */

const busyByEmail = ref<Record<string, BusyInterval[]>>({});

watch(
    [attendees, startLocal, startDate, allDay],
    async () => {
        if (attendees.value.length === 0 || eventDraft.value === null) {
            busyByEmail.value = {};

            return;
        }

        const dayRef = allDay.value ? startDate.value : startLocal.value;
        const day = startOfDay(dayRef ? new Date(dayRef) : new Date());

        try {
            busyByEmail.value = await fetchInviteeBusy(
                attendees.value,
                day.toISOString(),
                addDays(day, 1).toISOString(),
            );
        } catch {
            busyByEmail.value = {};
        }
    },
    { immediate: false },
);

/** Position a busy interval within the 6:00–22:00 window as %. */
function busyStyle(interval: BusyInterval, day: Date): Record<string, string> {
    const from = Math.max(
        0,
        differenceInMinutes(parseISO(interval.start), day) - DAY_START_MIN,
    );
    const to = Math.min(
        DAY_WINDOW_MIN,
        differenceInMinutes(parseISO(interval.end), day) - DAY_START_MIN,
    );

    return {
        left: `${(from / DAY_WINDOW_MIN) * 100}%`,
        width: `${(Math.max(to - from, 4) / DAY_WINDOW_MIN) * 100}%`,
    };
}

const availabilityDay = computed<Date>(() => {
    const ref_ = allDay.value ? startDate.value : startLocal.value;

    return startOfDay(ref_ ? new Date(ref_) : new Date());
});

/** The proposed slot as a % band across the strip (timed events only). */
const slotStyle = computed<Record<string, string> | null>(() => {
    if (allDay.value || !startLocal.value || !endLocal.value) {
        return null;
    }

    const day = availabilityDay.value;
    const from = differenceInMinutes(new Date(startLocal.value), day) - DAY_START_MIN;
    const to = differenceInMinutes(new Date(endLocal.value), day) - DAY_START_MIN;

    return {
        left: `${(Math.max(0, from) / DAY_WINDOW_MIN) * 100}%`,
        width: `${(Math.max(to - from, 4) / DAY_WINDOW_MIN) * 100}%`,
    };
});

async function save(): Promise<void> {
    error.value = null;

    if (summary.value.trim() === '') {
        error.value = 'Add a title.';

        return;
    }

    if (calendarId.value === '') {
        error.value = 'Connect a Google calendar to create events.';

        return;
    }

    let start: string;
    let end: string;

    if (allDay.value) {
        start = startDate.value;
        end = format(addDays(new Date(endDate.value || startDate.value), 1), 'yyyy-MM-dd');
    } else {
        const startAt = new Date(startLocal.value);
        const endAt = new Date(endLocal.value);

        if (!(endAt > startAt)) {
            error.value = 'End must be after start.';

            return;
        }

        start = startAt.toISOString();
        end = endAt.toISOString();
    }

    saving.value = true;

    try {
        await createEvent({
            calendarId: calendarId.value,
            summary: summary.value.trim(),
            description: description.value.trim() || null,
            location: location.value.trim() || null,
            allDay: allDay.value,
            start,
            end,
            attendees: attendees.value,
            addMeet: addMeet.value,
        });
        closeEventEditor();
    } catch {
        error.value = "Couldn't create the event — check your connection.";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-md gap-0 p-0">
            <DialogHeader class="px-5 pt-5 pb-2">
                <DialogTitle>{{ isMeeting ? 'New meeting' : 'New timeblock' }}</DialogTitle>
                <DialogDescription class="sr-only">
                    Create a calendar event.
                </DialogDescription>
            </DialogHeader>

            <div class="max-h-[70vh] space-y-3 overflow-y-auto px-5 pb-5">
                <input
                    v-model="summary"
                    type="text"
                    placeholder="Title"
                    class="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                    @keydown.enter.prevent="save"
                />

                <label class="flex items-center gap-2 text-sm">
                    <input v-model="allDay" type="checkbox" class="size-4" />
                    All day
                </label>

                <div class="grid grid-cols-2 gap-2">
                    <template v-if="allDay">
                        <label class="text-xs text-muted-foreground">
                            Start
                            <input
                                v-model="startDate"
                                type="date"
                                class="mt-0.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                            />
                        </label>
                        <label class="text-xs text-muted-foreground">
                            End
                            <input
                                v-model="endDate"
                                type="date"
                                class="mt-0.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                            />
                        </label>
                    </template>
                    <template v-else>
                        <label class="text-xs text-muted-foreground">
                            Start
                            <input
                                v-model="startLocal"
                                type="datetime-local"
                                class="mt-0.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                            />
                        </label>
                        <label class="text-xs text-muted-foreground">
                            End
                            <input
                                v-model="endLocal"
                                type="datetime-local"
                                class="mt-0.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                            />
                        </label>
                    </template>
                </div>

                <label class="block text-xs text-muted-foreground">
                    Calendar
                    <select
                        v-model="calendarId"
                        class="mt-0.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    >
                        <option
                            v-for="calendar in googleCalendars"
                            :key="calendar.id"
                            :value="calendar.id"
                        >
                            {{ calendar.name }}
                        </option>
                    </select>
                </label>

                <template v-if="isMeeting">
                <!-- Invitees -->
                <div>
                    <div class="flex flex-wrap items-center gap-1">
                        <span
                            v-for="email in attendees"
                            :key="email"
                            class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                            {{ nameByEmail.get(email) ?? email }}
                            <button
                                type="button"
                                class="text-muted-foreground hover:text-foreground"
                                @click="removeInvitee(email)"
                            >
                                <X class="size-3" />
                            </button>
                        </span>
                    </div>
                    <input
                        v-model="inviteeInput"
                        type="email"
                        placeholder="Invite by email…"
                        class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary"
                        @keydown.enter.prevent="addInvitee(inviteeInput)"
                    />
                    <div
                        v-if="otherColleagues.length > 0"
                        class="mt-1 flex flex-wrap gap-1"
                    >
                        <button
                            v-for="member in otherColleagues"
                            :key="member.email"
                            type="button"
                            class="rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60"
                            @click="addInvitee(member.email)"
                        >
                            + {{ member.name }}
                        </button>
                    </div>
                </div>

                <!-- Availability preview -->
                <div v-if="attendees.length > 0" class="space-y-1">
                    <p class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        Availability · {{ format(availabilityDay, 'EEE, MMM d') }} · 6a–10p
                    </p>
                    <div
                        v-for="email in attendees"
                        :key="email"
                        class="flex items-center gap-2"
                    >
                        <span class="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
                            {{ nameByEmail.get(email) ?? email }}
                        </span>
                        <div
                            class="relative h-4 flex-1 overflow-hidden rounded bg-muted/40"
                        >
                            <span
                                v-for="(interval, index) in busyByEmail[email] ?? []"
                                :key="index"
                                class="absolute inset-y-0 rounded-sm bg-muted-foreground/50"
                                :style="busyStyle(interval, availabilityDay)"
                            />
                            <span
                                v-if="slotStyle"
                                class="absolute inset-y-0 rounded-sm border border-primary bg-primary/30"
                                :style="slotStyle"
                            />
                        </div>
                    </div>
                </div>

                <label
                    class="flex items-center gap-2 text-sm"
                    title="Attach a Google Meet link"
                >
                    <input v-model="addMeet" type="checkbox" class="size-4" />
                    <Video class="size-4 text-muted-foreground" /> Add Google Meet
                </label>

                <input
                    v-model="location"
                    type="text"
                    placeholder="Location (optional)"
                    class="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                />
                <textarea
                    v-model="description"
                    rows="2"
                    placeholder="Notes (optional)"
                    class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                </template>

                <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

                <div class="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" size="sm" @click="closeEventEditor">
                        Cancel
                    </Button>
                    <Button size="sm" :disabled="saving" @click="save">
                        {{ saving ? 'Creating…' : 'Create' }}
                    </Button>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>
