import { ref } from 'vue';

/**
 * A promise-based replacement for window.prompt(), which Electron does not
 * support (it silently returns null). Call promptText(...) and await the
 * result; the shared <PromptDialog> mounted at the app root renders the
 * input and resolves the promise with the trimmed value, or null on cancel.
 */
export interface PromptOptions {
    title: string;
    label?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
}

interface PromptState extends PromptOptions {
    open: boolean;
    resolve: ((value: string | null) => void) | null;
}

export const promptState = ref<PromptState>({
    open: false,
    title: '',
    resolve: null,
});

export function promptText(options: PromptOptions): Promise<string | null> {
    // A prompt already open resolves to null before the next one opens.
    promptState.value.resolve?.(null);

    return new Promise((resolve) => {
        promptState.value = { ...options, open: true, resolve };
    });
}

export function resolvePrompt(value: string | null): void {
    const { resolve } = promptState.value;
    promptState.value = { open: false, title: '', resolve: null };
    resolve?.(value);
}

/**
 * A promise-based replacement for window.confirm(), which is unreliable in
 * the Electron shell (and jarring everywhere else). Call confirmAction(...)
 * and await the boolean; the shared <ConfirmDialog> renders it.
 */
export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    /** Destructive actions render the confirm button in red. */
    destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
    open: boolean;
    resolve: ((value: boolean) => void) | null;
}

export const confirmState = ref<ConfirmState>({
    open: false,
    title: '',
    resolve: null,
});

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
    // A confirm already open resolves to false before the next one opens.
    confirmState.value.resolve?.(false);

    return new Promise((resolve) => {
        confirmState.value = { ...options, open: true, resolve };
    });
}

export function resolveConfirm(value: boolean): void {
    const { resolve } = confirmState.value;
    confirmState.value = { open: false, title: '', resolve: null };
    resolve?.(value);
}
