import type { SwipeEvent } from '@/composables/useSwipe';

export type SwipeAction =
    | 'open-menu'
    | 'close-menu'
    | 'calendar-next'
    | 'calendar-prev'
    | null;

export interface SwipeContext {
    /** Is the off-canvas navigation menu currently open? */
    menuOpen: boolean;
    /** Is a split pane showing (gestures stay out of its way)? */
    hasSplit: boolean;
    /** Is the main view a calendar note? */
    isCalendar: boolean;
    /** Phone-sized viewport (sidebar is off-canvas)? */
    narrow: boolean;
    /** Did the gesture begin over the note body? */
    startedInPane: boolean;
}

const EDGE = 28;
const CALENDAR_MIN = 60;
/** A swipe must be this many times more horizontal than vertical to count. */
const HORIZONTAL_RATIO = 1.4;

/**
 * Decide what a completed swipe should do, kept pure so it's testable
 * without touch hardware. Vertical-ish swipes and anything ambiguous
 * return null (no gesture).
 */
export function resolveSwipeAction(
    swipe: Pick<SwipeEvent, 'direction' | 'startX' | 'distanceX' | 'distanceY'>,
    ctx: SwipeContext,
): SwipeAction {
    const horizontal =
        (swipe.direction === 'left' || swipe.direction === 'right') &&
        Math.abs(swipe.distanceX) >= Math.abs(swipe.distanceY) * HORIZONTAL_RATIO;

    if (!horizontal) {
        return null;
    }

    // While the menu is open, only a leftward swipe (to dismiss it) matters.
    if (ctx.menuOpen) {
        return swipe.direction === 'left' ? 'close-menu' : null;
    }

    if (
        swipe.direction === 'right' &&
        swipe.startX <= EDGE &&
        !ctx.hasSplit &&
        ctx.narrow
    ) {
        return 'open-menu';
    }

    if (
        Math.abs(swipe.distanceX) >= CALENDAR_MIN &&
        ctx.isCalendar &&
        !ctx.hasSplit &&
        ctx.startedInPane
    ) {
        return swipe.direction === 'left' ? 'calendar-next' : 'calendar-prev';
    }

    return null;
}
