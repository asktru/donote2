<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { CloudUpload, Loader2, Mic, TriangleAlert, X } from '@lucide/vue';
import { computed } from 'vue';

import type { MemoGroup } from '@/stores/memos';
import {
    cancelMemoGroup,
    discardRecording,
    isRecording,
    memoGroups,
    recordingSeconds,
} from '@/stores/memos';

const hasContent = computed(
    () => isRecording.value || memoGroups.value.length > 0,
);

const page = usePage();

/**
 * A memo files into the team it was RECORDED in; when that isn't the team
 * currently open, label the row so a "Waiting…" entry is understandable.
 */
function teamLabel(group: MemoGroup): string | null {
    if (group.teamSlug === page.props.currentTeam?.slug) {
        return null;
    }

    const team = (page.props.teams ?? []).find(
        (candidate) => candidate.slug === group.teamSlug,
    );

    return team?.name ?? group.teamSlug;
}

function statusLabel(group: MemoGroup): string {
    if (group.status === 'failed') {
        return group.error ?? 'Failed — will retry';
    }

    const progress =
        group.partsKnown > 1
            ? ` ${Math.min(group.partsDone + 1, group.partsKnown)}/${group.partsKnown}`
            : '';

    if (group.status === 'uploading') {
        return `Transcribing${progress}…`;
    }

    if (!group.finished) {
        return 'Recording continues…';
    }

    return navigator.onLine ? 'Waiting…' : 'Waiting for connection…';
}

function duration(totalSec: number): string {
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function timeLabel(group: MemoGroup): string {
    const time = new Date(group.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });

    return `${time} · ${duration(group.durationSec)}`;
}
</script>

<template>
    <section v-if="hasContent">
        <p
            class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
            Recordings
        </p>

        <div
            v-if="isRecording"
            class="group flex items-center gap-2 rounded-md px-2 py-1 text-sm"
        >
            <span class="relative flex size-2.5 shrink-0">
                <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60"
                />
                <span
                    class="relative inline-flex size-2.5 rounded-full bg-red-500"
                />
            </span>
            <span class="min-w-0 flex-1 truncate">
                Recording · {{ duration(recordingSeconds) }}
            </span>
            <button
                type="button"
                class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                title="Discard recording"
                aria-label="Discard recording"
                @click="discardRecording"
            >
                <X class="size-3.5" />
            </button>
        </div>

        <div
            v-for="memoGroup in memoGroups"
            :key="memoGroup.groupId"
            class="group flex items-center gap-2 rounded-md px-2 py-1 text-sm"
        >
            <Loader2
                v-if="memoGroup.status === 'uploading'"
                class="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
            <TriangleAlert
                v-else-if="memoGroup.status === 'failed'"
                class="size-3.5 shrink-0 text-amber-500"
            />
            <CloudUpload
                v-else
                class="size-3.5 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1">
                <span class="block truncate text-xs">
                    <Mic class="mr-0.5 inline size-3" />
                    {{ timeLabel(memoGroup) }}
                    <span
                        v-if="teamLabel(memoGroup)"
                        class="ml-1 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                    >
                        {{ teamLabel(memoGroup) }}
                    </span>
                </span>
                <span
                    class="block truncate text-[11px] text-muted-foreground"
                    :title="memoGroup.error ?? undefined"
                >
                    {{ statusLabel(memoGroup) }}
                </span>
            </span>
            <button
                v-if="memoGroup.finished || !isRecording"
                type="button"
                class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                title="Cancel this recording"
                aria-label="Cancel recording"
                @click="cancelMemoGroup(memoGroup.groupId)"
            >
                <X class="size-3.5" />
            </button>
        </div>
    </section>
</template>
