<script setup lang="ts">
import { Minus, Plus, RotateCcw, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { renderMermaid } from '@/lib/mermaid';
import { mermaidPreview } from '@/stores/ui';

const stage = ref<HTMLDivElement | null>(null);
const svg = ref<string>('');
const error = ref<string>('');

const scale = ref(1);
const tx = ref(0);
const ty = ref(0);

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

function close(): void {
    mermaidPreview.value = null;
}

function reset(): void {
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
}

function clampScale(value: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function zoomBy(factor: number): void {
    scale.value = clampScale(scale.value * factor);
}

/** Render the diagram whenever a new source is opened. */
watch(
    mermaidPreview,
    async (code) => {
        if (code === null) {
            return;
        }

        reset();
        svg.value = '';
        error.value = '';

        try {
            // Mermaid stamps an inline `max-width` sized to the diagram's
            // natural width, which would keep it tiny here. Drop it so the
            // diagram fills the readable base width set in CSS.
            svg.value = (await renderMermaid(code)).replace(
                /max-width:\s*[\d.]+px/g,
                'max-width:none',
            );
        } catch (e: unknown) {
            error.value =
                e instanceof Error ? e.message : 'could not render diagram';
        }
    },
    { immediate: true },
);

/** Wheel zooms toward the cursor; keeps the point under the pointer stable. */
function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const el = stage.value;

    if (!el) {
        return;
    }

    const rect = el.getBoundingClientRect();
    const cx = event.clientX - rect.left - rect.width / 2;
    const cy = event.clientY - rect.top - rect.height / 2;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = clampScale(scale.value * factor);
    const ratio = next / scale.value;

    // Re-anchor the translation so the cursor stays over the same diagram point.
    tx.value = cx - (cx - tx.value) * ratio;
    ty.value = cy - (cy - ty.value) * ratio;
    scale.value = next;
}

let dragging = false;
let startX = 0;
let startY = 0;
let startTx = 0;
let startTy = 0;

function onPointerDown(event: PointerEvent): void {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startTx = tx.value;
    startTy = ty.value;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
    if (!dragging) {
        return;
    }

    tx.value = startTx + (event.clientX - startX);
    ty.value = startTy + (event.clientY - startY);
}

function onPointerUp(): void {
    dragging = false;
}

function onKeydown(event: KeyboardEvent): void {
    if (mermaidPreview.value === null) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        close();
    } else if (event.key === '0') {
        reset();
    } else if (event.key === '+' || event.key === '=') {
        zoomBy(1.2);
    } else if (event.key === '-') {
        zoomBy(1 / 1.2);
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<template>
    <Teleport to="body">
        <div
            v-if="mermaidPreview !== null"
            class="fixed inset-0 z-[70] flex flex-col bg-black/85 backdrop-blur-sm"
        >
            <div
                ref="stage"
                class="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
                @wheel="onWheel"
                @pointerdown="onPointerDown"
                @pointermove="onPointerMove"
                @pointerup="onPointerUp"
                @pointercancel="onPointerUp"
            >
                <div
                    v-if="error"
                    class="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-sm text-red-300"
                >
                    Diagram error: {{ error }}
                </div>
                <!-- eslint-disable-next-line vue/no-v-html — SVG comes from mermaid's strict renderer -->
                <div
                    v-else
                    class="mermaid-stage-inner absolute top-1/2 left-1/2 origin-center"
                    :style="{
                        transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`,
                    }"
                    v-html="svg"
                />
            </div>

            <div class="absolute top-4 right-4 flex gap-2">
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    title="Zoom out (−)"
                    aria-label="Zoom out"
                    @click="zoomBy(1 / 1.2)"
                >
                    <Minus class="size-4.5" />
                </button>
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    title="Zoom in (+)"
                    aria-label="Zoom in"
                    @click="zoomBy(1.2)"
                >
                    <Plus class="size-4.5" />
                </button>
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    title="Reset (0)"
                    aria-label="Reset zoom"
                    @click="reset"
                >
                    <RotateCcw class="size-4.5" />
                </button>
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    title="Close (Esc)"
                    aria-label="Close"
                    @click="close"
                >
                    <X class="size-4.5" />
                </button>
            </div>

            <p
                class="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70"
            >
                Scroll to zoom · drag to pan
            </p>
        </div>
    </Teleport>
</template>

<style scoped>
.mermaid-stage-inner :deep(svg) {
    max-width: none;
    height: auto;
    /* A readable base size; zoom scales from here. */
    width: min(80vw, 1100px);
}
</style>
