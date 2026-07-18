<script setup lang="ts">
import { computed } from 'vue';

import { inlineSegments } from '@/lib/inlineTitle';

const props = defineProps<{ text: string }>();

const segments = computed(() => inlineSegments(props.text));
</script>

<template>
    <!-- Inline styling mirrors the editor's tokens (shared CSS variables). -->
    <span
        ><template v-for="(seg, index) in segments" :key="index"><strong
                v-if="seg.kind === 'bold'"
                class="font-semibold"
                >{{ seg.text }}</strong
            ><em v-else-if="seg.kind === 'italic'">{{ seg.text }}</em
            ><code
                v-else-if="seg.kind === 'code'"
                class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                >{{ seg.text }}</code
            ><span
                v-else-if="seg.kind === 'highlight'"
                class="rounded-[3px] px-0.5"
                :style="{ backgroundColor: 'var(--highlight)' }"
                >{{ seg.text }}</span
            ><span
                v-else-if="seg.kind === 'tag'"
                :style="{ color: 'var(--token-tag)' }"
                >{{ seg.text }}</span
            ><span
                v-else-if="seg.kind === 'mention'"
                :style="{ color: 'var(--token-mention)' }"
                >{{ seg.text }}</span
            ><span v-else-if="seg.kind === 'wikilink'" class="text-primary">{{
                seg.text
            }}</span
            ><span
                v-else-if="seg.kind === 'link'"
                class="text-primary underline decoration-primary/40 underline-offset-2"
                >{{ seg.text }}</span
            ><template v-else>{{ seg.text }}</template></template
        ></span
    >
</template>
