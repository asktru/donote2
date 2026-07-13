<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { CalendarPlus, Check, Copy, Trash2, Webhook } from '@lucide/vue';
import { computed, ref } from 'vue';

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
import {
    store as bluedotStore,
    destroy as bluedotDestroy,
} from '@/routes/integrations/bluedot';

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

interface TeamOption {
    id: number;
    name: string;
}

interface BluedotWebhook {
    id: number;
    team: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
}

const props = defineProps<{
    googleAccounts: GoogleAccountView[];
    googleConfigured: boolean;
    teams: TeamOption[];
    bluedotWebhooks: BluedotWebhook[];
}>();

const page = usePage<{
    flash: { bluedotUrl: string | null; bluedotTeam: string | null };
}>();

const selectedTeamId = ref<number | null>(props.teams[0]?.id ?? null);
const copied = ref(false);

/** The freshly minted URL, shown once right after generation. */
const newWebhookUrl = computed(() => page.props.flash?.bluedotUrl ?? null);
const newWebhookTeam = computed(() => page.props.flash?.bluedotTeam ?? null);

function generateWebhook(): void {
    if (selectedTeamId.value === null) {
        return;
    }

    router.post(
        bluedotStore().url,
        { team_id: selectedTeamId.value },
        { preserveScroll: true },
    );
}

function revokeWebhook(id: number): void {
    if (!confirm('Revoke this webhook URL? Bluedot will stop delivering to it.')) {
        return;
    }

    router.delete(bluedotDestroy(id).url, { preserveScroll: true });
}

async function copyUrl(): Promise<void> {
    if (newWebhookUrl.value === null) {
        return;
    }

    await navigator.clipboard.writeText(newWebhookUrl.value);
    copied.value = true;
    setTimeout(() => {
        copied.value = false;
    }, 2000);
}

function formatDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString() : '—';
}

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

        <div class="space-y-4 border-t border-border pt-6">
            <div>
                <h3 class="text-sm font-medium">Bluedot meetings</h3>
                <p class="text-sm text-muted-foreground">
                    Generate a webhook URL and paste it into Bluedot. Meeting
                    summaries land in the chosen team's
                    <span class="font-mono text-xs">Meetings</span> folder and
                    are linked from that day's daily note.
                </p>
            </div>

            <div class="flex flex-wrap items-end gap-2">
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Team</span>
                    <select
                        v-model="selectedTeamId"
                        class="h-9 min-w-48 rounded-md border border-border bg-background px-2 text-sm"
                    >
                        <option
                            v-for="team in teams"
                            :key="team.id"
                            :value="team.id"
                        >
                            {{ team.name }}
                        </option>
                    </select>
                </label>
                <Button :disabled="selectedTeamId === null" @click="generateWebhook">
                    <Webhook class="size-4" /> Generate webhook URL
                </Button>
            </div>

            <div
                v-if="newWebhookUrl"
                class="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4"
            >
                <p class="text-sm font-medium">
                    Webhook URL for “{{ newWebhookTeam }}”
                </p>
                <p class="text-xs text-muted-foreground">
                    Copy it now — for security it won't be shown again. Paste it
                    as the webhook URL in Bluedot.
                </p>
                <div class="flex items-center gap-2">
                    <code
                        class="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
                    >
                        {{ newWebhookUrl }}
                    </code>
                    <Button variant="outline" size="sm" @click="copyUrl">
                        <Check v-if="copied" class="size-4" />
                        <Copy v-else class="size-4" />
                        {{ copied ? 'Copied' : 'Copy' }}
                    </Button>
                </div>
            </div>

            <div
                v-if="bluedotWebhooks.length > 0"
                class="divide-y divide-border rounded-xl border border-border"
            >
                <div
                    v-for="webhook in bluedotWebhooks"
                    :key="webhook.id"
                    class="flex items-center justify-between gap-3 p-3"
                >
                    <div class="min-w-0">
                        <p class="truncate text-sm font-medium">
                            {{ webhook.team ?? 'Unknown team' }}
                        </p>
                        <p class="text-xs text-muted-foreground">
                            Created {{ formatDate(webhook.createdAt) }} · Last
                            used
                            {{
                                webhook.lastUsedAt
                                    ? formatDate(webhook.lastUsedAt)
                                    : 'never'
                            }}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="text-muted-foreground hover:text-destructive"
                        @click="revokeWebhook(webhook.id)"
                    >
                        <Trash2 class="size-4" /> Revoke
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>
