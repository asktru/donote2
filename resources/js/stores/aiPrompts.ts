import { ref } from 'vue';

import { workspaceConfig } from '@/stores/workspace';

/**
 * Saved AI prompts (device-local, per workspace) and the state of the
 * "run a prompt" dialog.
 */

export interface SavedPrompt {
    id: string;
    title: string;
    prompt: string;
}

const DEFAULT_PROMPTS: Omit<SavedPrompt, 'id'>[] = [
    {
        title: 'Clean up transcript',
        prompt: 'Clean up this raw voice transcript: fix punctuation and obvious mistranscriptions, remove filler words, and split it into readable paragraphs. Keep every language as spoken; do not translate or summarize.',
    },
    {
        title: 'Summarize',
        prompt: 'Summarize this text as a few concise markdown bullet points, keeping the key decisions and facts.',
    },
    {
        title: 'Extract action items',
        prompt: 'Extract every task, commitment, and follow-up from this text as markdown tasks, one per line, in the form "- [ ] task". Include the owner in @mention form when named.',
    },
    {
        title: 'Translate to English',
        prompt: 'Translate this text to natural English, preserving the markdown structure.',
    },
];

export const savedPrompts = ref<SavedPrompt[]>([]);
export const aiDialogOpen = ref(false);

let loadedFor: string | null = null;

function storageKey(): string | null {
    const config = workspaceConfig();

    return config
        ? `donote:ai-prompts:${config.teamSlug}:${config.userId}`
        : null;
}

export function loadSavedPrompts(): void {
    const key = storageKey();

    if (key === null || key === loadedFor) {
        return;
    }

    loadedFor = key;

    try {
        const raw = localStorage.getItem(key);

        if (raw !== null) {
            savedPrompts.value = JSON.parse(raw) as SavedPrompt[];

            return;
        }
    } catch {
        // Fall through to defaults.
    }

    savedPrompts.value = DEFAULT_PROMPTS.map((prompt) => ({
        ...prompt,
        id: crypto.randomUUID(),
    }));
    persist();
}

function persist(): void {
    const key = storageKey();

    if (key !== null) {
        try {
            localStorage.setItem(key, JSON.stringify(savedPrompts.value));
        } catch {
            // Best-effort.
        }
    }
}

export function savePrompt(title: string, prompt: string): void {
    savedPrompts.value = [
        ...savedPrompts.value,
        { id: crypto.randomUUID(), title, prompt },
    ];
    persist();
}

export function deletePrompt(id: string): void {
    savedPrompts.value = savedPrompts.value.filter(
        (prompt) => prompt.id !== id,
    );
    persist();
}
