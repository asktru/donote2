/**
 * What Esc means inside the Meet-with panel.
 *
 * Two presses, in the order the work happens: the first undoes the search —
 * whatever was typed, and the people already overlaid — and only once there is
 * nothing left to undo does Esc dismiss the panel. That way a mistyped name
 * never costs the panel, and a panel with nothing in it closes on one press.
 */
export type MeetWithEscape = 'clear' | 'dismiss';

export function meetWithEscape(options: {
    /** The autocomplete had a query (or an open popover) to throw away. */
    typed: boolean;
    /** How many colleagues are currently overlaid. */
    selected: number;
}): MeetWithEscape {
    return options.typed || options.selected > 0 ? 'clear' : 'dismiss';
}
