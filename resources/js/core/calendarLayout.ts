/**
 * Column layout for overlapping timed events within a single day.
 *
 * Each item carries its minute offsets from the day's start (0–1440). The
 * algorithm groups mutually-overlapping items into clusters and packs each
 * cluster into the fewest side-by-side lanes, so the view can render an event
 * at `left = lane / lanes` with `width = 1 / lanes` of the day column.
 */
export interface DayLayoutInput {
    startMin: number;
    endMin: number;
}

export interface DayLayoutItem<T> {
    item: T;
    /** 0-based column this item sits in within its overlap cluster. */
    lane: number;
    /** Number of columns the cluster was split into. */
    lanes: number;
}

export function layoutDayColumns<T extends DayLayoutInput>(
    items: T[],
): DayLayoutItem<T>[] {
    const sorted = [...items].sort(
        (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
    );

    const result: DayLayoutItem<T>[] = [];
    let columns: T[][] = [];
    let clusterEnd = -Infinity;

    const flush = (): void => {
        const lanes = columns.length;

        columns.forEach((column, lane) => {
            for (const item of column) {
                result.push({ item, lane, lanes });
            }
        });

        columns = [];
    };

    for (const item of sorted) {
        // A gap with the whole cluster ends it — start a fresh lane set.
        if (item.startMin >= clusterEnd) {
            flush();
            clusterEnd = -Infinity;
        }

        const column = columns.find(
            (col) => col[col.length - 1].endMin <= item.startMin,
        );

        if (column) {
            column.push(item);
        } else {
            columns.push([item]);
        }

        clusterEnd = Math.max(clusterEnd, item.endMin);
    }

    flush();

    return result;
}
