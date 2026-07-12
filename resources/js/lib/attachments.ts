import type { EditorView } from '@codemirror/view';
import { EditorView as View } from '@codemirror/view';
import { toast } from 'vue-sonner';

import { apiUpload } from '@/lib/api';
import { workspaceConfig } from '@/stores/workspace';

/**
 * Attachment uploads: files pasted or dropped into the editor (or picked
 * via the + button) go to the attachments API; a markdown image or file
 * link is inserted where they landed.
 */

interface UploadedAttachment {
    id: string;
    name: string;
    mime: string;
    size: number;
    url: string;
}

export async function uploadAttachment(
    file: File,
    noteId?: string,
): Promise<UploadedAttachment> {
    const config = workspaceConfig();

    if (!config) {
        throw new Error('Workspace is not ready yet.');
    }

    const form = new FormData();
    form.append('file', file);

    if (noteId) {
        form.append('note_id', noteId);
    }

    return apiUpload<UploadedAttachment>(
        `/api/${config.teamSlug}/attachments`,
        form,
    );
}

export function attachmentMarkdown(attachment: UploadedAttachment): string {
    const label = attachment.name.replace(/[[\]]/g, '');

    return attachment.mime.startsWith('image/')
        ? `![${label}](${attachment.url})`
        : `[${label}](${attachment.url})`;
}

/** Upload files and insert their links at `pos` (or the cursor). */
export async function insertAttachments(
    view: EditorView,
    files: File[],
    pos?: number,
    noteId?: string,
): Promise<void> {
    if (files.length === 0) {
        return;
    }

    if (!navigator.onLine) {
        toast.error('Attachments need a connection — try again when online.');

        return;
    }

    const at = pos ?? view.state.selection.main.head;
    const uploading = toast.loading(
        files.length === 1
            ? `Uploading ${files[0].name}…`
            : `Uploading ${files.length} files…`,
    );

    try {
        const links: string[] = [];

        for (const file of files) {
            const attachment = await uploadAttachment(file, noteId);
            links.push(attachmentMarkdown(attachment));
        }

        const insert = links.join('\n');
        view.dispatch({
            changes: { from: at, to: at, insert },
            selection: { anchor: at + insert.length },
        });
        toast.success(
            files.length === 1 ? 'Attached' : `Attached ${files.length} files`,
            { id: uploading },
        );
    } catch (error) {
        toast.error(
            error instanceof Error ? error.message : 'Upload failed',
            { id: uploading },
        );
    }
}

/** Editor extension: paste and drag-drop files become attachments. */
export function attachmentHandlers(getNoteId: () => string | undefined) {
    return View.domEventHandlers({
        paste(event, view) {
            const files = [...(event.clipboardData?.files ?? [])];

            if (files.length === 0) {
                return false;
            }

            event.preventDefault();
            void insertAttachments(view, files, undefined, getNoteId());

            return true;
        },
        drop(event, view) {
            const files = [...(event.dataTransfer?.files ?? [])];

            if (files.length === 0) {
                return false;
            }

            event.preventDefault();
            const pos = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
            });
            void insertAttachments(
                view,
                files,
                pos ?? undefined,
                getNoteId(),
            );

            return true;
        },
    });
}
