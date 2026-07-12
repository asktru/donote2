import type { Priority } from '@/core/parser';

/**
 * Task priority palette, shared by the editor and every task list so a
 * !/!!/!!! task looks identical everywhere: blue → orange → red as urgency
 * climbs. Priority 0 (none) has no colour.
 */
export const PRIORITY_COLORS: Record<1 | 2 | 3, string> = {
    3: '#dc4c3e',
    2: '#eb8909',
    1: '#246fe0',
};

/** Colour for a priority level, or null when the task has no priority. */
export function priorityColor(priority: Priority): string | null {
    return priority === 0 ? null : PRIORITY_COLORS[priority];
}
