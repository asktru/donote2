<script setup lang="ts">
import { FilePlus } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    defaultTemplateMonth,
    renderTemplate,
} from '@/lib/noteTemplates';
import type { TemplateMonth } from '@/lib/noteTemplates';
import {
    closeTemplateDialog,
    templateDialogNoteId,
} from '@/stores/templateDialog';
import { createNote, folders, getNote } from '@/stores/workspace';

const emit = defineEmits<{
    'open-note': [id: string];
}>();

const FOLDER_MEMORY_PREFIX = 'donote:template-folder:';

const monthValue = ref('');
const targetFolder = ref('');

const template = computed(() =>
    templateDialogNoteId.value !== null
        ? (getNote(templateDialogNoteId.value) ?? null)
        : null,
);

/** Reset the form each time the dialog opens for a template. */
watch(template, (note) => {
    if (!note) {
        return;
    }

    const suggested = defaultTemplateMonth();
    monthValue.value = `${suggested.year}-${String(suggested.month).padStart(2, '0')}`;

    try {
        targetFolder.value =
            localStorage.getItem(FOLDER_MEMORY_PREFIX + note.id) ?? '';
    } catch {
        targetFolder.value = '';
    }
});

const targetMonth = computed<TemplateMonth | null>(() => {
    const match = monthValue.value.match(/^(\d{4})-(\d{2})$/);

    return match
        ? { year: Number(match[1]), month: Number(match[2]) }
        : null;
});

const preview = computed(() =>
    template.value && targetMonth.value
        ? renderTemplate(
              template.value.content,
              template.value.title || 'Untitled',
              targetMonth.value,
          )
        : null,
);

async function generate(): Promise<void> {
    const rendered = preview.value;

    if (!template.value || !rendered) {
        return;
    }

    try {
        localStorage.setItem(
            FOLDER_MEMORY_PREFIX + template.value.id,
            targetFolder.value,
        );
    } catch {
        // Folder memory is a convenience; generation proceeds without it.
    }

    const note = await createNote({
        title: rendered.title,
        folder: targetFolder.value,
        content: rendered.content,
    });

    closeTemplateDialog();
    emit('open-note', note.id);
}

function onOpenChange(open: boolean): void {
    if (!open) {
        closeTemplateDialog();
    }
}
</script>

<template>
    <Dialog :open="template !== null" @update:open="onOpenChange">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>New note from template</DialogTitle>
                <DialogDescription>
                    Generate a note from
                    “{{ template?.title || 'Untitled' }}” — date placeholders
                    fill in from the chosen month.
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-3">
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Month</span>
                    <input
                        v-model="monthValue"
                        type="month"
                        class="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    />
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Folder</span>
                    <select
                        v-model="targetFolder"
                        class="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    >
                        <option value="">Notes (top level)</option>
                        <option
                            v-for="folder in folders"
                            :key="folder"
                            :value="folder"
                        >
                            {{ folder }}
                        </option>
                    </select>
                </label>

                <p
                    v-if="preview"
                    class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                    <span class="text-muted-foreground">Creates: </span>
                    <span class="font-medium">{{ preview.title }}</span>
                </p>
            </div>

            <DialogFooter>
                <Button :disabled="!preview" @click="generate">
                    <FilePlus class="size-4" /> Create note
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
