<script setup lang="ts">
import { Globe, Loader2 } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { NoteSharing } from '@/lib/noteAccess';
import { getNoteSharing, updateNoteSharing } from '@/lib/sharing';
import { teamMembers } from '@/stores/team';
import { workspaceConfig } from '@/stores/workspace';

const props = defineProps<{
    open: boolean;
    noteId: string;
}>();

const emit = defineEmits<{
    'update:open': [value: boolean];
    /** The note's access no longer includes some members — reconcile. */
    saved: [];
}>();

/** Per-member choice in the picker. */
type MemberAccess = 'none' | 'read' | 'write';

const teamReadable = ref(false);
const choices = ref<Map<number, MemberAccess>>(new Map());
const loading = ref(false);
const saving = ref(false);

/** Everyone on the team except the author (you can't share to yourself). */
const others = computed(() => {
    const me = workspaceConfig()?.userId;

    return teamMembers.value.filter((member) => member.id !== me);
});

function accessOf(userId: number): MemberAccess {
    return choices.value.get(userId) ?? 'none';
}

function setAccess(userId: number, value: MemberAccess): void {
    choices.value.set(userId, value);
    // Trigger reactivity on the Map.
    choices.value = new Map(choices.value);
}

async function load(): Promise<void> {
    loading.value = true;

    try {
        const sharing = await getNoteSharing(props.noteId);
        teamReadable.value = sharing.team_readable;
        choices.value = new Map(
            sharing.shares.map((share) => [share.user_id, share.access]),
        );
    } catch {
        teamReadable.value = false;
        choices.value = new Map();
    } finally {
        loading.value = false;
    }
}

watch(
    () => props.open,
    (open) => {
        if (open) {
            void load();
        }
    },
);

async function save(): Promise<void> {
    saving.value = true;

    const sharing: NoteSharing = {
        team_readable: teamReadable.value,
        shares: [...choices.value.entries()]
            .filter(([, access]) => access !== 'none')
            .map(([user_id, access]) => ({
                user_id,
                access: access as Exclude<MemberAccess, 'none'>,
            })),
    };

    try {
        await updateNoteSharing(props.noteId, sharing);
        emit('saved');
        emit('update:open', false);
    } finally {
        saving.value = false;
    }
}

const accessLabels: { value: MemberAccess; label: string }[] = [
    { value: 'none', label: 'No access' },
    { value: 'read', label: 'Can view' },
    { value: 'write', label: 'Can edit' },
];
</script>

<template>
    <Dialog
        :open="open"
        @update:open="(value) => emit('update:open', value)"
    >
        <DialogContent class="max-w-md">
            <DialogTitle>Share note</DialogTitle>

            <div v-if="loading" class="flex justify-center py-8">
                <Loader2 class="size-5 animate-spin text-muted-foreground" />
            </div>

            <template v-else>
                <label
                    class="flex items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2.5"
                >
                    <Globe class="size-4 shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1">
                        <span class="block text-sm font-medium"
                            >Anyone in the team can view</span
                        >
                        <span class="block text-xs text-muted-foreground"
                            >Read-only for every current and future
                            member</span
                        >
                    </span>
                    <input
                        v-model="teamReadable"
                        type="checkbox"
                        class="size-4"
                    />
                </label>

                <div class="mt-3 max-h-72 space-y-1 overflow-y-auto">
                    <p
                        v-if="others.length === 0"
                        class="px-1 py-4 text-center text-sm text-muted-foreground"
                    >
                        No teammates to share with yet.
                    </p>
                    <div
                        v-for="member in others"
                        :key="member.id"
                        class="flex items-center gap-2 rounded-lg px-1.5 py-1.5"
                    >
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm">{{
                                member.name
                            }}</span>
                            <span
                                class="block truncate text-xs text-muted-foreground"
                                >{{ member.email }}</span
                            >
                        </span>
                        <select
                            :value="accessOf(member.id)"
                            class="rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                            @change="
                                setAccess(
                                    member.id,
                                    ($event.target as HTMLSelectElement)
                                        .value as MemberAccess,
                                )
                            "
                        >
                            <option
                                v-for="option in accessLabels"
                                :key="option.value"
                                :value="option.value"
                            >
                                {{ option.label }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class="mt-4 flex justify-end gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        @click="emit('update:open', false)"
                    >
                        Cancel
                    </Button>
                    <Button size="sm" :disabled="saving" @click="save">
                        {{ saving ? 'Saving…' : 'Save' }}
                    </Button>
                </div>
            </template>
        </DialogContent>
    </Dialog>
</template>
