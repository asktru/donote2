/**
 * Read a file from the native iOS container through a plugin's readFile
 * method, in base64 chunks. The iOS shell loads the remote web app, so
 * Capacitor's convertFileSrc file serving doesn't exist — fetching a
 * converted URL would hit the production server, not the device.
 */

export type NativeFileRead = (options: {
    path: string;
    offset: number;
    length: number;
}) => Promise<{ base64: string; size: number }>;

/** ~2 MB of raw bytes per bridge round-trip keeps memory and JSON sane. */
const CHUNK_BYTES = 2 * 1024 * 1024;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

export async function readNativeFileBlob(
    read: NativeFileRead,
    path: string,
    mimeType: string,
): Promise<Blob> {
    const parts: BlobPart[] = [];
    let offset = 0;

    for (;;) {
        const { base64, size } = await read({
            path,
            offset,
            length: CHUNK_BYTES,
        });

        if (base64 !== '') {
            const bytes = base64ToBytes(base64);
            parts.push(bytes);
            offset += bytes.length;
        }

        if (base64 === '' || offset >= size) {
            break;
        }
    }

    return new Blob(parts, { type: mimeType });
}
