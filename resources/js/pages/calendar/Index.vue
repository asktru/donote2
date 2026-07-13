<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { computed, onMounted } from 'vue';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    anchorLabel,
    calendarView,
    goToday,
    setCalendarView,
    stepCalendar,
} from '@/stores/calendar';
import { setTeamMembers } from '@/stores/team';
import type { TeamMember } from '@/stores/team';

const props = defineProps<{
    workspace: {
        teamSlug: string;
        teamName: string;
        userId: number;
    };
    members: TeamMember[];
    googleConnected: boolean;
}>();

const views: { value: 'day' | 'week' | 'month'; label: string }[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
];

const notesHref = computed(() => `/${props.workspace.teamSlug}/notes`);

onMounted(() => {
    setTeamMembers(props.members);
});
</script>

<template>
    <Head title="Calendar" />

    <div class="flex h-screen min-h-0 flex-col bg-background text-foreground">
        <header
            class="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"
        >
            <nav class="flex items-center gap-1 text-sm">
                <Link
                    :href="notesHref"
                    class="rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted/60"
                >
                    Notes
                </Link>
                <span class="rounded-md bg-muted px-2.5 py-1 font-medium">
                    Calendar
                </span>
            </nav>

            <div class="mx-2 flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    aria-label="Previous"
                    @click="stepCalendar(-1)"
                >
                    <ChevronLeft class="size-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    aria-label="Next"
                    @click="stepCalendar(1)"
                >
                    <ChevronRight class="size-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="ml-1 h-8 px-3 text-xs"
                    @click="goToday"
                >
                    Today
                </Button>
            </div>

            <h1 class="text-base font-semibold">{{ anchorLabel }}</h1>

            <div class="ml-auto flex items-center rounded-lg border border-border/60 p-0.5">
                <button
                    v-for="view in views"
                    :key="view.value"
                    type="button"
                    :class="
                        cn(
                            'rounded-md px-3 py-1 text-xs font-medium',
                            calendarView === view.value
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                        )
                    "
                    @click="setCalendarView(view.value)"
                >
                    {{ view.label }}
                </button>
            </div>
        </header>

        <div class="min-h-0 flex-1 overflow-hidden">
            <p class="p-6 text-sm text-muted-foreground">
                Calendar views are being assembled…
                <span v-if="!googleConnected">
                    Connect Google Calendar in Settings to see your events.
                </span>
            </p>
        </div>
    </div>
</template>
