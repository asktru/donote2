<script setup lang="ts">
import { Copy, Loader2, Play, Replace, Sparkles, Trash2 } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    aiDialogOpen,
    createPromptNote,
    promptNotes,
    seedStarterPrompts,
} from '@/stores/aiPrompts';
import { activeEditor } from '@/stores/editorRegistry';
import { workspaceConfig } from '@/stores/workspace';

/**
 * Runs a prompt against the current editor selection (or the whole note
 * when nothing is selected), previews the result, and lets the user
 * discard it, copy it, or apply it to the editor.
 */

interface Target {
    text: string;
    from: number;
    to: number;
    wholeNote: boolean;
}

const target = ref<Target | null>(null);
const customPrompt = ref('');
const running = ref(false);
const runError = ref<string | null>(null);
const result = ref<string | null>(null);
const lastPrompt = ref('');
const saveTitle = ref('');
const showSave = ref(false);

const targetLabel = computed(() => {
    if (!target.value) {
        return 'No note is focused';
    }

    const words = target.value.text.split(/\s+/).filter(Boolean).length;

    return target.value.wholeNote
        ? `Whole note · ${words} words`
        : `Selection · ${words} words`;
});

watch(aiDialogOpen, (open) => {
    if (!open) {
        return;
    }

    result.value = null;
    runError.value = null;
    showSave.value = false;
    saveTitle.value = '';

    const view = activeEditor.value;

    if (!view) {
        target.value = null;

        return;
    }

    const { from, to } = view.state.selection.main;

    target.value =
        from === to
            ? {
                  text: view.state.doc.toString(),
                  from: 0,
                  to: view.state.doc.length,
                  wholeNote: true,
              }
            : { text: view.state.sliceDoc(from, to), from, to, wholeNote: false };
});

async function run(prompt: string): Promise<void> {
    const config = workspaceConfig();

    if (!target.value || !config || prompt.trim() === '') {
        return;
    }

    running.value = true;
    runError.value = null;
    result.value = null;
    lastPrompt.value = prompt;

    try {
        const response = await apiFetch<{ text: string }>(
            `/api/${config.teamSlug}/ai/completions`,
            {
                method: 'POST',
                body: JSON.stringify({ prompt, text: target.value.text }),
            },
        );
        result.value = response.text;
    } catch (error) {
        runError.value =
            error instanceof Error ? error.message : 'AI request failed';
    } finally {
        running.value = false;
    }
}

async function copyResult(): Promise<void> {
    if (result.value !== null) {
        await navigator.clipboard.writeText(result.value);
        aiDialogOpen.value = false;
    }
}

/** Replace the selection (or whole note) with the result. */
function applyResult(): void {
    const view = activeEditor.value;

    if (!view || !target.value || result.value === null) {
        return;
    }

    const to = Math.min(target.value.to, view.state.doc.length);

    view.dispatch({
        changes: { from: target.value.from, to, insert: result.value },
    });
    aiDialogOpen.value = false;
    view.focus();
}

async function saveCurrentPrompt(): Promise<void> {
    if (saveTitle.value.trim() !== '' && customPrompt.value.trim() !== '') {
        await createPromptNote(
            saveTitle.value.trim(),
            customPrompt.value.trim(),
        );
        showSave.value = false;
        saveTitle.value = '';
    }
}
</script>

<template>
    <Dialog v-model:open="aiDialogOpen">
        <DialogContent class="flex max-h-[80vh] flex-col sm:max-w-lg">
            <DialogHeader>
                <DialogTitle class="flex items-center gap-2">
                    <Sparkles class="size-4" /> AI prompt
                </DialogTitle>
                <DialogDescription>{{ targetLabel }}</DialogDescription>
            </DialogHeader>

            <div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div
                    v-if="promptNotes.length > 0"
                    class="flex flex-wrap gap-1.5"
                >
                    <button
                        v-for="prompt in promptNotes"
                        :key="prompt.id"
                        type="button"
                        class="rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium hover:bg-muted/70 disabled:opacity-50"
                        :disabled="running || !target"
                        :title="prompt.prompt"
                        @click="run(prompt.prompt)"
                    >
                        {{ prompt.title }}
                    </button>
                </div>
                <div
                    v-else
                    class="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/70 px-3 py-2"
                >
                    <p class="text-xs text-muted-foreground">
                        Notes with
                        <code class="rounded bg-muted px-1">type: prompt</code>
                        appear here as one-click prompts.
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        class="h-7 shrink-0 px-2 text-xs"
                        @click="seedStarterPrompts"
                    >
                        Add starter prompts
                    </Button>
                </div>

                <div class="space-y-2">
                    <textarea
                        v-model="customPrompt"
                        rows="2"
                        placeholder="Or type a one-off instruction… e.g. “Rewrite as a polite email in French”"
                        class="w-full resize-none rounded-md border border-border/70 bg-background px-2.5 py-2 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                        @keydown.meta.enter.prevent="run(customPrompt)"
                    ></textarea>
                    <div class="flex items-center gap-2">
                        <Button
                            size="sm"
                            class="h-7 gap-1.5 px-2.5 text-xs"
                            :disabled="running || !target || customPrompt.trim() === ''"
                            @click="run(customPrompt)"
                        >
                            <Play class="size-3.5" /> Run
                        </Button>
                        <Button
                            v-if="!showSave"
                            variant="ghost"
                            size="sm"
                            class="h-7 px-2 text-xs text-muted-foreground"
                            :disabled="customPrompt.trim() === ''"
                            @click="showSave = true"
                        >
                            Save prompt…
                        </Button>
                        <template v-else>
                            <input
                                v-model="saveTitle"
                                placeholder="Prompt name"
                                class="h-7 w-36 rounded-md border border-border/70 bg-background px-2 text-xs focus:outline-none"
                                @keydown.enter.prevent="saveCurrentPrompt"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                class="h-7 px-2 text-xs"
                                @click="saveCurrentPrompt"
                            >
                                Save
                            </Button>
                        </template>
                    </div>
                </div>

                <div
                    v-if="running"
                    class="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-6 text-sm text-muted-foreground"
                >
                    <Loader2 class="size-4 animate-spin" /> Running “{{
                        lastPrompt.slice(0, 60)
                    }}”…
                </div>

                <p v-else-if="runError" class="text-sm text-red-500">
                    {{ runError }}
                </p>

                <div v-else-if="result !== null" class="space-y-2">
                    <pre
                        :class="
                            cn(
                                'max-h-64 overflow-y-auto rounded-md border border-border/60 bg-muted/30 px-3 py-2',
                                'font-sans text-sm break-words whitespace-pre-wrap',
                            )
                        "
                        >{{ result }}</pre
                    >
                    <div class="flex items-center gap-2">
                        <Button
                            size="sm"
                            class="h-7 gap-1.5 px-2.5 text-xs"
                            @click="applyResult"
                        >
                            <Replace class="size-3.5" />
                            {{
                                target?.wholeNote
                                    ? 'Replace note'
                                    : 'Replace selection'
                            }}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-7 gap-1.5 px-2.5 text-xs"
                            @click="copyResult"
                        >
                            <Copy class="size-3.5" /> Copy
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground"
                            @click="result = null"
                        >
                            <Trash2 class="size-3.5" /> Discard
                        </Button>
                    </div>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>
