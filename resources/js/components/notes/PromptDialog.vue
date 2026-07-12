<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { promptState, resolvePrompt } from '@/stores/prompt';

const value = ref('');
const inputEl = ref<InstanceType<typeof Input> | null>(null);

watch(
    () => promptState.value.open,
    async (open) => {
        if (!open) {
            return;
        }

        value.value = promptState.value.initialValue ?? '';
        await nextTick();
        const el = (inputEl.value?.$el ?? inputEl.value) as
            | HTMLInputElement
            | undefined;
        el?.focus();
        el?.select();
    },
);

function submit(): void {
    const trimmed = value.value.trim();
    resolvePrompt(trimmed === '' ? null : trimmed);
}

/** Dialog's open state only ever goes false here (Escape, overlay). */
function onOpenChange(open: boolean): void {
    if (!open) {
        resolvePrompt(null);
    }
}
</script>

<template>
    <Dialog :open="promptState.open" @update:open="onOpenChange">
        <DialogContent class="sm:max-w-sm">
            <DialogHeader>
                <DialogTitle>{{ promptState.title }}</DialogTitle>
            </DialogHeader>

            <form class="space-y-3" @submit.prevent="submit">
                <label
                    v-if="promptState.label"
                    class="text-sm text-muted-foreground"
                >
                    {{ promptState.label }}
                </label>
                <Input
                    ref="inputEl"
                    v-model="value"
                    :placeholder="promptState.placeholder"
                    autocomplete="off"
                />

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        @click="resolvePrompt(null)"
                    >
                        Cancel
                    </Button>
                    <Button type="submit" :disabled="value.trim() === ''">
                        {{ promptState.confirmLabel ?? 'Create' }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
