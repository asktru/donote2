<script setup lang="ts">
/**
 * Going / Maybe / Declined for one invitation.
 *
 * A repeating invite asks which copies the answer covers before sending
 * anything: a misclick on a daily standup should not answer forty
 * occurrences. One-off events skip the prompt and answer straight away.
 */
import { Check, CircleQuestionMark, X } from '@lucide/vue';
import { ref } from 'vue';
import { toast } from 'vue-sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { respondToEvent } from '@/stores/calendar';
import type { CalendarEvent, RsvpAnswer, RsvpScope } from '@/stores/calendar';

const props = withDefaults(
    defineProps<{
        event: CalendarEvent;
        /** `compact` is the popover row; `full` is the detail panel. */
        size?: 'full' | 'compact';
    }>(),
    { size: 'full' },
);

const ANSWERS: { value: RsvpAnswer; label: string; icon: typeof Check }[] = [
    { value: 'accepted', label: 'Going', icon: Check },
    { value: 'tentative', label: 'Maybe', icon: CircleQuestionMark },
    { value: 'declined', label: 'Declined', icon: X },
];

const ANSWER_CLASS: Record<RsvpAnswer, string> = {
    accepted: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    tentative: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    declined: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

/** The answer waiting on a "this event / all events" decision. */
const askingScopeFor = ref<RsvpAnswer | null>(null);
const sending = ref(false);

function choose(answer: RsvpAnswer): void {
    if (props.event.seriesId !== null) {
        askingScopeFor.value = answer;

        return;
    }

    void send(answer, 'one');
}

async function send(answer: RsvpAnswer, scope: RsvpScope): Promise<void> {
    askingScopeFor.value = null;
    sending.value = true;

    try {
        await respondToEvent(props.event, answer, scope);
    } catch {
        toast.error("Couldn't send your reply.");
    } finally {
        sending.value = false;
    }
}
</script>

<template>
    <div>
        <div
            v-if="askingScopeFor === null"
            :class="cn('flex gap-1.5', size === 'compact' && 'gap-1')"
        >
            <Button
                v-for="answer in ANSWERS"
                :key="answer.value"
                variant="outline"
                size="sm"
                :disabled="sending"
                :aria-pressed="event.responseStatus === answer.value"
                :class="
                    cn(
                        'gap-1.5',
                        size === 'compact'
                            ? 'h-7 px-2 text-[11px]'
                            : 'h-8 flex-1 text-xs',
                        event.responseStatus === answer.value &&
                            ANSWER_CLASS[answer.value],
                    )
                "
                @click.stop="choose(answer.value)"
            >
                <component :is="answer.icon" class="size-3.5 shrink-0" />
                {{ answer.label }}
            </Button>
        </div>

        <div v-else class="space-y-1.5">
            <p class="text-xs text-muted-foreground">
                Reply
                {{
                    ANSWERS.find((a) => a.value === askingScopeFor)?.label
                }}&nbsp;to…
            </p>
            <div class="flex flex-wrap gap-1.5">
                <Button
                    variant="outline"
                    size="sm"
                    class="h-7 px-2 text-[11px]"
                    @click.stop="send(askingScopeFor, 'one')"
                >
                    This event
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="h-7 px-2 text-[11px]"
                    @click.stop="send(askingScopeFor, 'series')"
                >
                    All events
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-[11px] text-muted-foreground"
                    @click.stop="askingScopeFor = null"
                >
                    Cancel
                </Button>
            </div>
        </div>
    </div>
</template>
