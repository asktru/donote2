/**
 * Pick a legible text color (near-black or white) for a solid background,
 * using perceived luminance. Falls back to white for unknown inputs.
 */
export function readableTextColor(background: string | null): string {
    if (!background || !background.startsWith('#')) {
        return '#ffffff';
    }

    let hex = background.slice(1);

    if (hex.length === 3) {
        hex = hex
            .split('')
            .map((c) => c + c)
            .join('');
    }

    if (hex.length !== 6) {
        return '#ffffff';
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.6 ? '#111827' : '#ffffff';
}
