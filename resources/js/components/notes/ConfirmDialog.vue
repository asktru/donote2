<script setup lang="ts">
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { confirmState, resolveConfirm } from '@/stores/prompt';

/** Dialog's open state only ever goes false here (Escape, overlay). */
function onOpenChange(open: boolean): void {
    if (!open) {
        resolveConfirm(false);
    }
}
</script>

<template>
    <Dialog :open="confirmState.open" @update:open="onOpenChange">
        <DialogContent class="sm:max-w-sm">
            <DialogHeader>
                <DialogTitle>{{ confirmState.title }}</DialogTitle>
                <DialogDescription v-if="confirmState.message">
                    {{ confirmState.message }}
                </DialogDescription>
            </DialogHeader>

            <DialogFooter>
                <Button
                    type="button"
                    variant="ghost"
                    @click="resolveConfirm(false)"
                >
                    Cancel
                </Button>
                <Button
                    type="button"
                    :variant="confirmState.destructive ? 'destructive' : 'default'"
                    @click="resolveConfirm(true)"
                >
                    {{ confirmState.confirmLabel ?? 'Confirm' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
