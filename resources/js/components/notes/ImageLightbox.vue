<script setup lang="ts">
import { Download, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted } from 'vue';

import { lightboxImage } from '@/stores/ui';

function close(): void {
    lightboxImage.value = null;
}

async function download(): Promise<void> {
    const image = lightboxImage.value;

    if (!image) {
        return;
    }

    const response = await fetch(image.url, { credentials: 'same-origin' });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = image.alt || 'image';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && lightboxImage.value !== null) {
        event.preventDefault();
        close();
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<template>
    <Teleport to="body">
        <div
            v-if="lightboxImage"
            class="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm"
            @click="close"
        >
            <img
                :src="lightboxImage.url"
                :alt="lightboxImage.alt"
                class="max-h-[94vh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
                @click.stop
            />
            <div class="absolute top-4 right-4 flex gap-2">
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    title="Download image"
                    aria-label="Download image"
                    @click.stop="download"
                >
                    <Download class="size-4.5" />
                </button>
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    title="Close (Esc)"
                    aria-label="Close"
                    @click.stop="close"
                >
                    <X class="size-4.5" />
                </button>
            </div>
        </div>
    </Teleport>
</template>
