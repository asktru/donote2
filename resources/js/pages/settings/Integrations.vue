<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { CalendarPlus, Trash2 } from '@lucide/vue';
import { ref } from 'vue';

import Heading from '@/components/Heading.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { apiFetch } from '@/lib/api';
import { redirect as googleRedirect } from '@/routes/google';
import {
    update as updateAccount,
    destroy as destroyAccount,
} from '@/routes/google/accounts';
import { edit } from '@/routes/integrations';

interface GoogleCalendarOption {
    id: string;
    summary: string;
    color: string | null;
    primary: boolean;
    selected: boolean;
}

interface GoogleAccountView {
    id: number;
    email: string;
    calendars: GoogleCalendarOption[];
}

const props = defineProps<{
    googleAccounts: GoogleAccountView[];
    googleConfigured: boolean;
}>();

defineOptions({
    layout: {
        breadcrumbs: [
            {
                title: 'Integrations',
                href: edit(),
            },
        ],
    },
});

const accounts = ref<GoogleAccountView[]>([...props.googleAccounts]);
const busy = ref(false);

async function toggleCalendar(
    account: GoogleAccountView,
    calendarId: string,
    selected: boolean,
): Promise<void> {
    const calendar = account.calendars.find((entry) => entry.id === calendarId);

    if (calendar) {
        calendar.selected = selected;
    }

    busy.value = true;

    try {
        await apiFetch(updateAccount(account.id).url, {
            method: 'PATCH',
            body: JSON.stringify({
                selected_calendar_ids: account.calendars
                    .filter((entry) => entry.selected)
                    .map((entry) => entry.id),
            }),
        });
    } finally {
        busy.value = false;
    }
}

async function disconnect(account: GoogleAccountView): Promise<void> {
    if (!confirm(`Disconnect ${account.email}?`)) {
        return;
    }

    await apiFetch(destroyAccount(account.id).url, { method: 'DELETE' });
    accounts.value = accounts.value.filter((entry) => entry.id !== account.id);
    router.reload();
}
</script>

<template>
    <Head title="Integrations" />

    <div class="space-y-6">
        <Heading
            variant="small"
            title="Integrations"
            description="Connect external services to your workspace"
        />

        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-medium">Google Calendar</h3>
                    <p class="text-sm text-muted-foreground">
                        Show events from one or more Google accounts next to
                        your notes.
                    </p>
                </div>
                <Button as-child :disabled="!googleConfigured">
                    <a :href="googleRedirect().url">
                        <CalendarPlus class="size-4" /> Connect account
                    </a>
                </Button>
            </div>

            <p
                v-if="!googleConfigured"
                class="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground"
            >
                Set <code class="font-mono text-xs">GOOGLE_CLIENT_ID</code> and
                <code class="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> in
                your <code class="font-mono text-xs">.env</code>
                to enable this integration.
            </p>

            <div
                v-for="account in accounts"
                :key="account.id"
                class="rounded-xl border border-border p-4"
            >
                <div class="flex items-center justify-between">
                    <p class="text-sm font-medium">{{ account.email }}</p>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="text-muted-foreground hover:text-destructive"
                        @click="disconnect(account)"
                    >
                        <Trash2 class="size-4" /> Disconnect
                    </Button>
                </div>

                <div class="mt-3 space-y-2">
                    <label
                        v-for="calendar in account.calendars"
                        :key="calendar.id"
                        class="flex cursor-pointer items-center gap-2.5"
                    >
                        <Checkbox
                            :model-value="calendar.selected"
                            :disabled="busy"
                            @update:model-value="
                                (value) =>
                                    toggleCalendar(
                                        account,
                                        calendar.id,
                                        value === true,
                                    )
                            "
                        />
                        <span
                            class="inline-block size-3 rounded-full"
                            :style="{
                                backgroundColor:
                                    calendar.color ?? 'var(--primary)',
                            }"
                        />
                        <span class="text-sm">
                            {{ calendar.summary }}
                            <span
                                v-if="calendar.primary"
                                class="text-xs text-muted-foreground"
                                >(primary)</span
                            >
                        </span>
                    </label>
                </div>
            </div>
        </div>
    </div>
</template>
