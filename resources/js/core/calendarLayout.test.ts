import { describe, expect, it } from 'vitest';

import { layoutDayColumns } from './calendarLayout';

function lanes(items: { id: string; startMin: number; endMin: number }[]) {
    return Object.fromEntries(
        layoutDayColumns(items).map((r) => [r.item.id, `${r.lane}/${r.lanes}`]),
    );
}

describe('layoutDayColumns', () => {
    it('gives non-overlapping events a single full-width lane', () => {
        expect(
            lanes([
                { id: 'a', startMin: 60, endMin: 120 },
                { id: 'b', startMin: 180, endMin: 240 },
            ]),
        ).toEqual({ a: '0/1', b: '0/1' });
    });

    it('splits two overlapping events into two lanes', () => {
        expect(
            lanes([
                { id: 'a', startMin: 60, endMin: 180 },
                { id: 'b', startMin: 120, endMin: 240 },
            ]),
        ).toEqual({ a: '0/2', b: '1/2' });
    });

    it('reuses a lane once the earlier event ends (three events, max 2 wide)', () => {
        // a: 0-60, b: 30-120 overlap (2 lanes); c: 70-130 overlaps only b,
        // but shares the cluster and can reuse lane 0 which a vacated.
        expect(
            lanes([
                { id: 'a', startMin: 0, endMin: 60 },
                { id: 'b', startMin: 30, endMin: 120 },
                { id: 'c', startMin: 70, endMin: 130 },
            ]),
        ).toEqual({ a: '0/2', b: '1/2', c: '0/2' });
    });

    it('starts a fresh lane set after a clean gap', () => {
        expect(
            lanes([
                { id: 'a', startMin: 0, endMin: 60 },
                { id: 'b', startMin: 10, endMin: 60 },
                { id: 'c', startMin: 120, endMin: 180 },
            ]),
        ).toEqual({ a: '0/2', b: '1/2', c: '0/1' });
    });
});
