import { describe, expect, it } from 'vitest';

import { readNativeFileBlob } from './nativeFile';

function toBase64(text: string): string {
    return btoa(text);
}

describe('readNativeFileBlob', () => {
    it('assembles a file read in chunks into one blob', async () => {
        const content = 'hello native world';

        const blob = await readNativeFileBlob(
            async ({ offset, length }) => ({
                base64: toBase64(content.slice(offset, offset + length)),
                size: content.length,
            }),
            '/tmp/file',
            'text/plain',
        );

        expect(blob.type).toBe('text/plain');
        expect(await blob.text()).toBe(content);
    });

    it('loops until the reported size is reached', async () => {
        const content = 'abcdefghij';
        const calls: number[] = [];

        const blob = await readNativeFileBlob(
            async ({ offset }) => {
                calls.push(offset);

                // Serve tiny 4-byte chunks regardless of requested length.
                return {
                    base64: toBase64(content.slice(offset, offset + 4)),
                    size: content.length,
                };
            },
            '/tmp/file',
            'application/octet-stream',
        );

        expect(await blob.text()).toBe(content);
        expect(calls).toEqual([0, 4, 8]);
    });

    it('stops on an empty chunk instead of looping forever', async () => {
        const blob = await readNativeFileBlob(
            async () => ({ base64: '', size: 100 }),
            '/tmp/file',
            'audio/mp4',
        );

        expect(blob.size).toBe(0);
    });
});
