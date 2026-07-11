import { computed, ref } from 'vue';

import { createNote, liveNotes, noteMetaFor } from '@/stores/workspace';

/**
 * AI prompts are regular notes with `type: prompt` front matter: the
 * title names the prompt, the body (below the front matter) is the
 * instruction. Being notes, they sync across devices, show up in
 * search, and are edited like anything else.
 */

export interface PromptNote {
    id: string;
    title: string;
    prompt: string;
}

export const aiDialogOpen = ref(false);

export const promptNotes = computed<PromptNote[]>(() =>
    liveNotes.value
        .filter(
            (note) =>
                note.type === 'note' &&
                noteMetaFor(note.id).type === 'prompt',
        )
        .map((note) => {
            const meta = noteMetaFor(note.id);
            const body = note.content
                .split('\n')
                .slice(meta.endLine + 1)
                .join('\n')
                .trim();

            return {
                id: note.id,
                title: note.title || 'Untitled prompt',
                prompt: body,
            };
        })
        .filter((prompt) => prompt.prompt !== '')
        .sort((a, b) => a.title.localeCompare(b.title)),
);

export async function createPromptNote(
    title: string,
    prompt: string,
): Promise<void> {
    await createNote({
        title,
        folder: 'Prompts',
        content: `---\ntype: prompt\n---\n\n${prompt.trim()}\n`,
    });
}

const STARTER_PROMPTS: [string, string][] = [
    [
        'Clean up transcript',
        'Clean up this raw voice transcript: fix punctuation and obvious mistranscriptions, remove filler words, and split it into readable paragraphs. Keep every language as spoken; do not translate or summarize.',
    ],
    [
        'Summarize',
        'Summarize this text as a few concise markdown bullet points, keeping the key decisions and facts.',
    ],
    [
        'Extract action items',
        'Extract every task, commitment, and follow-up from this text as markdown tasks, one per line, in the form "- [ ] task". Include the owner in @mention form when named.',
    ],
    [
        'Translate to English',
        'Translate this text to natural English, preserving the markdown structure.',
    ],
];

/** Create the four starter prompt notes (offered when none exist yet). */
export async function seedStarterPrompts(): Promise<void> {
    for (const [title, prompt] of STARTER_PROMPTS) {
        await createPromptNote(title, prompt);
    }
}
