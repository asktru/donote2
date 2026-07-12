import { onBeforeUnmount, onMounted } from 'vue';

import { isTouchDevice } from '@/lib/platform';

export interface SwipeEvent {
    direction: 'left' | 'right' | 'up' | 'down';
    /** Touch start position, in client (viewport) pixels. */
    startX: number;
    startY: number;
    /** Signed travel: positive right/down, negative left/up. */
    distanceX: number;
    distanceY: number;
    /** The element the gesture began on. */
    target: EventTarget | null;
}

interface Options {
    /** Minimum dominant-axis travel (px) to count as a swipe. */
    threshold?: number;
    /** Maximum gesture duration (ms); longer presses are ignored. */
    maxDuration?: number;
}

/**
 * Fire `handler` on a completed single-finger swipe. Listeners are passive —
 * the gesture never blocks native scrolling or text selection; callers decide
 * what (if anything) a given swipe means. Only attaches on touch devices.
 */
export function useSwipe(
    handler: (event: SwipeEvent) => void,
    { threshold = 45, maxDuration = 600 }: Options = {},
): void {
    if (!isTouchDevice) {
        return;
    }

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let target: EventTarget | null = null;
    let tracking = false;

    function onTouchStart(event: TouchEvent): void {
        if (event.touches.length !== 1) {
            tracking = false;

            return;
        }

        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        startTime = event.timeStamp;
        target = event.target;
        tracking = true;
    }

    function onTouchEnd(event: TouchEvent): void {
        if (!tracking || event.changedTouches.length === 0) {
            return;
        }

        tracking = false;

        if (event.timeStamp - startTime > maxDuration) {
            return;
        }

        const touch = event.changedTouches[0];
        const distanceX = touch.clientX - startX;
        const distanceY = touch.clientY - startY;
        const absX = Math.abs(distanceX);
        const absY = Math.abs(distanceY);

        if (Math.max(absX, absY) < threshold) {
            return;
        }

        const direction =
            absX > absY
                ? distanceX > 0
                    ? 'right'
                    : 'left'
                : distanceY > 0
                  ? 'down'
                  : 'up';

        handler({ direction, startX, startY, distanceX, distanceY, target });
    }

    onMounted(() => {
        window.addEventListener('touchstart', onTouchStart, { passive: true });
        window.addEventListener('touchend', onTouchEnd, { passive: true });
    });

    onBeforeUnmount(() => {
        window.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchend', onTouchEnd);
    });
}
