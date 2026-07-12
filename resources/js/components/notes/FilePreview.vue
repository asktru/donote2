<script setup lang="ts">
import { Download, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted } from 'vue';

import { isMacDesktopShell } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { filePreview } from '@/stores/ui';

function close(): void {
    filePreview.value = null;
}

/** Minimal CSV parser with quoted-field support. */
function parseCsv(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (inQuotes) {
            if (char === '"' && content[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && content[i + 1] === '\n') {
                i++;
            }

            row.push(field);
            field = '';

            if (row.some((cell) => cell !== '')) {
                rows.push(row);
            }

            row = [];
        } else {
            field += char;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);

        if (row.some((cell) => cell !== '')) {
            rows.push(row);
        }
    }

    return rows;
}

const csvRows = computed(() =>
    filePreview.value?.kind === 'csv'
        ? parseCsv(filePreview.value.content)
        : [],
);

async function download(): Promise<void> {
    const preview = filePreview.value;

    if (!preview) {
        return;
    }

    const response = await fetch(preview.url, { credentials: 'same-origin' });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = preview.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && filePreview.value !== null) {
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
            v-if="filePreview"
            class="fixed inset-0 z-[70] flex flex-col bg-black/85 backdrop-blur-sm"
            @click.self="close"
        >
            <div
                :class="
                    cn(
                        'flex shrink-0 items-center gap-3 px-5 py-3 text-white',
                        isMacDesktopShell && 'app-region-drag pl-20',
                    )
                "
            >
                <p class="min-w-0 flex-1 truncate text-sm font-medium">
                    {{ filePreview.name }}
                </p>
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/25"
                    title="Download"
                    aria-label="Download file"
                    @click="download"
                >
                    <Download class="size-4.5" />
                </button>
                <button
                    type="button"
                    class="flex size-9 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/25"
                    title="Close (Esc)"
                    aria-label="Close"
                    @click="close"
                >
                    <X class="size-4.5" />
                </button>
            </div>

            <div class="min-h-0 flex-1 px-5 pb-5" @click.self="close">
                <!-- Rendered HTML runs sandboxed: no scripts, no navigation. -->
                <iframe
                    v-if="filePreview.kind === 'html'"
                    :srcdoc="filePreview.content"
                    sandbox=""
                    class="size-full rounded-lg border border-white/20 bg-white"
                    title="HTML preview"
                ></iframe>

                <div
                    v-else-if="filePreview.kind === 'csv'"
                    class="size-full overflow-auto rounded-lg border border-white/20 bg-background"
                >
                    <table class="w-full border-collapse text-sm">
                        <tbody>
                            <tr
                                v-for="(row, r) in csvRows"
                                :key="r"
                                :class="
                                    r === 0
                                        ? 'sticky top-0 bg-muted font-semibold'
                                        : r % 2 === 1
                                          ? 'bg-muted/30'
                                          : ''
                                "
                            >
                                <td
                                    v-for="(cell, c) in row"
                                    :key="c"
                                    class="border border-border/60 px-2.5 py-1.5 align-top whitespace-pre-wrap"
                                >
                                    {{ cell }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <pre
                    v-else
                    class="size-full overflow-auto rounded-lg border border-white/20 bg-background px-5 py-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground"
                    >{{ filePreview.content }}</pre
                >
            </div>
        </div>
    </Teleport>
</template>
