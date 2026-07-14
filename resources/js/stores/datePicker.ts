import { ref } from 'vue';

/**
 * A single, app-wide date picker. Anything that needs a date (the editor's
 * schedule/due commands, the mobile toolbar, a project's start/due header)
 * opens it with a request describing the mode and a callback; the dialog
 * routes the chosen key — or null to clear — back through `onApply`.
 */

export type DatePickerMode = 'schedule' | 'due' | 'projectStart' | 'projectDue';

export interface DatePickerRequest {
    mode: DatePickerMode;
    /** Allow week/month/quarter/year selection (schedule) vs day-only. */
    allowPeriods: boolean;
    /** Existing value to pre-fill the picker with, or null. */
    current: string | null;
    /** Header shown in the dialog. */
    title: string;
    /** Apply the chosen calendar key, or null to clear the date. */
    onApply: (key: string | null) => void;
}

export const datePickerRequest = ref<DatePickerRequest | null>(null);

export function openDatePicker(request: DatePickerRequest): void {
    datePickerRequest.value = request;
}

export function closeDatePicker(): void {
    datePickerRequest.value = null;
}
