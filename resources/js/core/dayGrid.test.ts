import { describe, expect, it } from 'vitest';

import { layoutSharedDay } from '@/core/dayGrid';

function span(id: string, startMin: number, endMin: number) {
    return { id, startMin, endMin };
}

function laneOf(placed: { id: string; lane: number; lanes: number }[]) {
    return Object.fromEntries(
        placed.map((p) => [p.id, `${p.lane}/${p.lanes}`]),
    );
}

describe('layoutSharedDay', () => {
    it('leaves both full width when nothing overlaps', () => {
        const { mine, overlays } = layoutSharedDay(
            [span('mine', 60, 120)],
            [span('theirs', 180, 240)],
        );

        expect(laneOf(mine)).toEqual({ mine: '0/1' });
        expect(laneOf(overlays)).toEqual({ theirs: '0/1' });
    });

    it('splits my event and a colleague event side by side when they overlap', () => {
        const { mine, overlays } = layoutSharedDay(
            [span('mine', 60, 180)],
            [span('theirs', 120, 240)],
        );

        expect(laneOf(mine)).toEqual({ mine: '0/2' });
        expect(laneOf(overlays)).toEqual({ theirs: '1/2' });
    });

    it('keeps my event on the left when the two sit on the same slot', () => {
        const { mine, overlays } = layoutSharedDay(
            [span('mine', 540, 600)],
            [span('theirs', 540, 600)],
        );

        expect(mine[0].lane).toBe(0);
        expect(overlays[0].lane).toBe(1);
    });

    it('shares one lane set across two colleagues and me', () => {
        const { mine, overlays } = layoutSharedDay(
            [span('mine', 540, 600)],
            [span('a', 540, 600), span('b', 550, 610)],
        );

        expect(mine[0].lanes).toBe(3);
        expect(laneOf(overlays)).toEqual({ a: '1/3', b: '2/3' });
    });

    it('preserves input order within each group', () => {
        const { mine } = layoutSharedDay(
            [span('late', 600, 660), span('early', 60, 120)],
            [],
        );

        expect(mine.map((m) => m.id)).toEqual(['late', 'early']);
    });

    it('lays out my events alone exactly as the day layout would', () => {
        const { mine, overlays } = layoutSharedDay(
            [span('a', 0, 60), span('b', 30, 120)],
            [],
        );

        expect(laneOf(mine)).toEqual({ a: '0/2', b: '1/2' });
        expect(overlays).toEqual([]);
    });
});
