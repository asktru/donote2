/**
 * Laying out one day's worth of blocks when a colleague's calendar is overlaid
 * on the user's own ("Meet with").
 *
 * An overlay used to be drawn as a translucent wash across the whole column,
 * which made an overlap unreadable: two titles on top of each other, neither
 * legible. Treating the overlaid schedule as just another calendar — one shared
 * lane set for both — turns that overlap into side-by-side columns, the same
 * way two of the user's own events behave.
 */

import { layoutDayColumns } from '@/core/calendarLayout';

export interface DaySpan {
    startMin: number;
    endMin: number;
}

export interface LanePlacement {
    /** 0-based column within the overlap cluster. */
    lane: number;
    /** Columns the cluster was split into. */
    lanes: number;
}

interface Tagged extends DaySpan {
    mine: boolean;
    order: number;
}

/**
 * Place the user's events and the overlaid ones in a single lane set, keeping
 * each group's input order. Ties go to the user's own event, so their day
 * stays on the left where they expect to read it.
 */
export function layoutSharedDay<M extends DaySpan, O extends DaySpan>(
    mine: M[],
    overlays: O[],
): { mine: (M & LanePlacement)[]; overlays: (O & LanePlacement)[] } {
    const tagged: Tagged[] = [
        ...mine.map((span, order) => ({
            startMin: span.startMin,
            endMin: span.endMin,
            mine: true,
            order,
        })),
        ...overlays.map((span, order) => ({
            startMin: span.startMin,
            endMin: span.endMin,
            mine: false,
            order,
        })),
    ];

    const own = new Array<M & LanePlacement>(mine.length);
    const theirs = new Array<O & LanePlacement>(overlays.length);

    for (const { item, lane, lanes } of layoutDayColumns(tagged)) {
        if (item.mine) {
            own[item.order] = { ...mine[item.order], lane, lanes };
        } else {
            theirs[item.order] = { ...overlays[item.order], lane, lanes };
        }
    }

    return { mine: own, overlays: theirs };
}
