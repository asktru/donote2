<script setup lang="ts">
import { AlertTriangle, RefreshCw, RotateCcw } from '@lucide/vue';
import { format, formatDistanceToNow } from 'date-fns';
import { computed, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
    fetchServerStats,
    forceFullResync,
    lastSyncAt,
    lastSyncError,
    pendingChanges,
    rebuildLocalCopy,
    syncCursor,
    syncLog,
    syncNow,
    syncStatus,
} from '@/stores/sync';
import type { ServerStats } from '@/stores/sync';
import { syncPanelOpen } from '@/stores/ui';
import { dirtyNotes, liveNotes } from '@/stores/workspace';

const localCount = computed(() => liveNotes.value.length);
const dirtyCount = computed(() => dirtyNotes().length);

const busy = ref(false);
const confirmingRebuild = ref(false);
const serverStats = ref<ServerStats | null>(null);
const statsError = ref<string | null>(null);

const statusLabel = computed(() => {
    switch (syncStatus.value) {
        case 'offline':
            return 'Offline';
        case 'syncing':
            return 'Syncing…';
        case 'error':
            return 'Error';
        default:
            return 'Synced';
    }
});

const lastSyncLabel = computed(() =>
    lastSyncAt.value
        ? `${formatDistanceToNow(lastSyncAt.value)} ago`
        : 'not yet this session',
);

/** A visible gap between what the server shares and what we hold locally. */
const gap = computed<number | null>(() =>
    serverStats.value
        ? serverStats.value.visibleCount - localCount.value
        : null,
);

async function refreshStats(): Promise<void> {
    statsError.value = null;

    try {
        serverStats.value = await fetchServerStats();
    } catch (error) {
        statsError.value =
            error instanceof Error ? error.message : String(error);
    }
}

async function run(action: () => Promise<void>): Promise<void> {
    if (busy.value) {
        return;
    }

    busy.value = true;

    try {
        await action();
        await refreshStats();
    } catch {
        // The action already recorded the failure into the sync log.
    } finally {
        busy.value = false;
        confirmingRebuild.value = false;
    }
}

// Pull a fresh server snapshot each time the panel opens.
watch(syncPanelOpen, (open) => {
    if (open) {
        confirmingRebuild.value = false;
        void refreshStats();
    }
});

function logColor(level: 'info' | 'warn' | 'error'): string {
    switch (level) {
        case 'error':
            return 'text-red-500';
        case 'warn':
            return 'text-amber-500';
        default:
            return 'text-muted-foreground';
    }
}
</script>

<template>
    <Dialog v-model:open="syncPanelOpen">
        <DialogContent class="max-w-lg gap-0 p-0">
            <DialogHeader class="px-5 pt-5 pb-3">
                <DialogTitle>Sync</DialogTitle>
                <DialogDescription>
                    Diagnose and repair this device's local copy. Your notes
                    always live on the server — these actions only re-fetch
                    them.
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-4 px-5 pb-5">
                <!-- Status grid -->
                <dl
                    class="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm"
                >
                    <div class="flex items-center justify-between">
                        <dt class="text-muted-foreground">Status</dt>
                        <dd class="font-medium">{{ statusLabel }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                        <dt class="text-muted-foreground">Last sync</dt>
                        <dd class="font-medium">{{ lastSyncLabel }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                        <dt class="text-muted-foreground">Notes here</dt>
                        <dd class="font-medium">{{ localCount }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                        <dt class="text-muted-foreground">On server</dt>
                        <dd class="font-medium">
                            {{ serverStats ? serverStats.visibleCount : '—' }}
                        </dd>
                    </div>
                    <div class="flex items-center justify-between">
                        <dt class="text-muted-foreground">Pending edits</dt>
                        <dd class="font-medium">{{ dirtyCount || pendingChanges }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                        <dt class="text-muted-foreground">Cursor</dt>
                        <dd class="font-medium tabular-nums">
                            {{ syncCursor }}<span
                                v-if="serverStats"
                                class="text-muted-foreground"
                                >/{{ serverStats.maxSeq }}</span
                            >
                        </dd>
                    </div>
                </dl>

                <!-- Gap warning -->
                <p
                    v-if="gap !== null && gap > 0"
                    class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
                >
                    <AlertTriangle class="mt-0.5 size-4 shrink-0" />
                    <span>
                        The server shares <b>{{ gap }}</b> note(s) this device
                        is missing. Run <b>Force Full Resync</b> to pull them
                        back.
                    </span>
                </p>

                <p v-if="statsError" class="text-xs text-red-500">
                    Couldn't reach the server: {{ statsError }}
                </p>
                <p v-else-if="lastSyncError" class="text-xs text-red-500">
                    Last error: {{ lastSyncError }}
                </p>

                <!-- Actions -->
                <div class="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        :disabled="busy"
                        @click="run(syncNow)"
                    >
                        <RefreshCw
                            :class="cn('size-4', busy && 'animate-spin')"
                        />
                        Sync now
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        :disabled="busy"
                        @click="run(forceFullResync)"
                    >
                        <RotateCcw class="size-4" />
                        Force full resync
                    </Button>
                </div>

                <!-- Destructive rebuild -->
                <div class="rounded-lg border border-border/60 p-3">
                    <p class="text-sm font-medium">Rebuild local copy</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                        Clears this device's cached notes and re-downloads
                        everything. Unpushed edits are sent first, so nothing
                        is lost. Use only if a resync doesn't fix it.
                    </p>

                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <template v-if="!confirmingRebuild">
                            <Button
                                variant="ghost"
                                size="sm"
                                class="text-destructive hover:text-destructive"
                                :disabled="busy"
                                @click="confirmingRebuild = true"
                            >
                                Rebuild…
                            </Button>
                        </template>
                        <template v-else>
                            <span class="text-xs text-muted-foreground"
                                >Are you sure?</span
                            >
                            <Button
                                variant="destructive"
                                size="sm"
                                :disabled="busy"
                                @click="run(rebuildLocalCopy)"
                            >
                                Yes, rebuild
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                :disabled="busy"
                                @click="confirmingRebuild = false"
                            >
                                Cancel
                            </Button>
                        </template>
                    </div>
                </div>

                <!-- Activity log -->
                <div>
                    <p
                        class="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                        Activity
                    </p>
                    <div
                        class="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed"
                    >
                        <p
                            v-if="syncLog.length === 0"
                            class="text-muted-foreground"
                        >
                            No sync activity yet.
                        </p>
                        <p
                            v-for="(entry, index) in [...syncLog].reverse()"
                            :key="`${entry.at}-${index}`"
                            :class="logColor(entry.level)"
                        >
                            <span class="text-muted-foreground/70"
                                >{{ format(entry.at, 'HH:mm:ss') }} </span
                            >{{ entry.message }}
                        </p>
                    </div>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>
