import { ref } from 'vue';

/** The template note the "New from template" dialog is open for. */
export const templateDialogNoteId = ref<string | null>(null);

export function openTemplateDialog(noteId: string): void {
    templateDialogNoteId.value = noteId;
}

export function closeTemplateDialog(): void {
    templateDialogNoteId.value = null;
}
