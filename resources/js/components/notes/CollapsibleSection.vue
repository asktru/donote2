<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';

import { cn } from '@/lib/utils';
import { isSectionCollapsed, toggleSection } from '@/stores/uiSections';

defineProps<{
    /** Stable id used to persist this section's collapse state per team. */
    sectionId: string;
    /** Plain-text header; override with the #title slot for custom styling. */
    title?: string;
}>();
</script>

<template>
    <section>
        <div class="flex items-center gap-1 px-2 pb-1">
            <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                @click="toggleSection(sectionId)"
            >
                <ChevronRight
                    :class="
                        cn(
                            'size-3 shrink-0 transition-transform',
                            !isSectionCollapsed(sectionId) && 'rotate-90',
                        )
                    "
                />
                <span class="min-w-0 flex-1 truncate text-left">
                    <slot name="title">{{ title }}</slot>
                </span>
            </button>
            <slot name="actions" />
        </div>

        <div v-if="!isSectionCollapsed(sectionId)">
            <slot />
        </div>
    </section>
</template>
