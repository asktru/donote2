<script setup lang="ts">
import { Search } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { searchZones, zoneCity, zoneOffsetLabel } from '@/lib/timezones';
import { cn } from '@/lib/utils';

const props = defineProps<{
    /** Every IANA zone the platform knows. */
    zones: string[];
    /** The zone currently on the grid, if any. */
    current: string | null;
}>();

const emit = defineEmits<{ select: [zone: string | null] }>();

const open = defineModel<boolean>('open', { required: true });
const query = ref('');

/** Capped: nobody scrolls 400 zones, and the list re-renders on every key. */
const results = computed(() => searchZones(props.zones, query.value, 60));

watch(open, (value) => {
    if (value) {
        query.value = '';
    }
});

function choose(zone: string | null): void {
    emit('select', zone);
    open.value = false;
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="flex max-h-[70vh] max-w-md flex-col gap-0 p-0">
            <DialogTitle class="px-4 pt-4 pb-2">Secondary timezone</DialogTitle>

            <div
                class="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5"
            >
                <Search class="size-4 shrink-0 text-muted-foreground" />
                <input
                    v-model="query"
                    class="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search a city or region… (e.g. “kiev”)"
                    autofocus
                />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <button
                    type="button"
                    class="flex w-full items-center rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60"
                    @click="choose(null)"
                >
                    No second timezone
                </button>

                <button
                    v-for="zone in results"
                    :key="zone"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/60',
                            zone === props.current && 'bg-muted',
                        )
                    "
                    @click="choose(zone)"
                >
                    <span class="min-w-0 flex-1 truncate">
                        {{ zoneCity(zone) }}
                        <span class="text-xs text-muted-foreground">
                            {{ zone }}
                        </span>
                    </span>
                    <span class="shrink-0 text-xs text-muted-foreground">
                        {{ zoneOffsetLabel(zone) }}
                    </span>
                </button>

                <p
                    v-if="results.length === 0"
                    class="px-2 py-6 text-center text-sm text-muted-foreground"
                >
                    No zone matches “{{ query }}”.
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
