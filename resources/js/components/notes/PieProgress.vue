<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        done: number;
        total: number;
        size?: number;
    }>(),
    {
        size: 16,
    },
);

const fraction = computed(() =>
    props.total > 0 ? Math.min(1, props.done / props.total) : 0,
);

/** SVG wedge from 12 o'clock, clockwise, for the completed fraction. */
const wedgePath = computed(() => {
    const f = fraction.value;

    if (f <= 0) {
        return '';
    }

    if (f >= 1) {
        return 'M8 8 m0 -5.2 a5.2 5.2 0 1 1 0 10.4 a5.2 5.2 0 1 1 0 -10.4';
    }

    const angle = f * 2 * Math.PI;
    const x = 8 + 5.2 * Math.sin(angle);
    const y = 8 - 5.2 * Math.cos(angle);
    const largeArc = f > 0.5 ? 1 : 0;

    return `M8 8 L8 2.8 A5.2 5.2 0 ${largeArc} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`;
});
</script>

<template>
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 16 16"
        class="shrink-0"
        role="img"
        :aria-label="`${done} of ${total} tasks done`"
    >
        <title>{{ done }}/{{ total }} tasks done</title>
        <circle
            cx="8"
            cy="8"
            r="6.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            class="text-primary"
        />
        <path
            v-if="wedgePath"
            :d="wedgePath"
            fill="currentColor"
            class="text-primary"
        />
    </svg>
</template>
