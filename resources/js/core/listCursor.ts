/**
 * Moving a highlight through a short list with the arrow keys.
 *
 * Wrapping rather than clamping: these lists are a handful of items in a
 * popover, where holding ↓ to reach the last one and finding yourself back at
 * the top is the expected behaviour.
 */
export function wrapIndex(
    current: number,
    delta: number,
    length: number,
): number {
    if (length <= 0) {
        return 0;
    }

    return (((current + delta) % length) + length) % length;
}
