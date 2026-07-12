import { describe, expect, it } from 'vitest';

import { resolveSwipeAction  } from './swipeActions';
import type {SwipeContext} from './swipeActions';

const base: SwipeContext = {
    menuOpen: false,
    hasSplit: false,
    isCalendar: true,
    narrow: true,
    startedInPane: true,
};

function swipe(
    direction: 'left' | 'right' | 'up' | 'down',
    distanceX: number,
    distanceY = 0,
    startX = 200,
) {
    return { direction, startX, distanceX, distanceY } as const;
}

describe('resolveSwipeAction', () => {
    it('opens the menu on a right swipe from the left edge (narrow only)', () => {
        expect(resolveSwipeAction(swipe('right', 90, 0, 10), base)).toBe(
            'open-menu',
        );
        // Not from the edge → no menu.
        expect(resolveSwipeAction(swipe('right', 90, 0, 200), base)).toBe(
            'calendar-prev',
        );
        // Wide viewport (sidebar already visible) → no edge-open.
        expect(
            resolveSwipeAction(swipe('right', 90, 0, 10), {
                ...base,
                narrow: false,
                isCalendar: false,
            }),
        ).toBeNull();
    });

    it('closes the menu on a left swipe while it is open', () => {
        expect(
            resolveSwipeAction(swipe('left', -90), { ...base, menuOpen: true }),
        ).toBe('close-menu');
        // A right swipe while open does nothing.
        expect(
            resolveSwipeAction(swipe('right', 90, 0, 10), {
                ...base,
                menuOpen: true,
            }),
        ).toBeNull();
    });

    it('steps the calendar on a horizontal swipe over the note body', () => {
        expect(resolveSwipeAction(swipe('left', -80), base)).toBe(
            'calendar-next',
        );
        expect(resolveSwipeAction(swipe('right', 80), base)).toBe(
            'calendar-prev',
        );
    });

    it('does not step the calendar outside a calendar view or over a split', () => {
        expect(
            resolveSwipeAction(swipe('left', -80), { ...base, isCalendar: false }),
        ).toBeNull();
        expect(
            resolveSwipeAction(swipe('left', -80), { ...base, hasSplit: true }),
        ).toBeNull();
        expect(
            resolveSwipeAction(swipe('left', -80), {
                ...base,
                startedInPane: false,
            }),
        ).toBeNull();
    });

    it('ignores mostly-vertical swipes (scrolling)', () => {
        expect(resolveSwipeAction(swipe('left', -80, 200), base)).toBeNull();
        expect(resolveSwipeAction(swipe('down', 0, 120), base)).toBeNull();
    });

    it('ignores small horizontal drift below the calendar threshold', () => {
        expect(resolveSwipeAction(swipe('left', -50), base)).toBeNull();
    });
});
