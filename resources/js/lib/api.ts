export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

function xsrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);

    return match ? decodeURIComponent(match[1]) : '';
}

/** Same-origin JSON fetch with Laravel session + CSRF handling. */
export async function apiFetch<T>(
    url: string,
    options: RequestInit = {},
): Promise<T> {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken(),
            ...(options.headers ?? {}),
        },
    });

    if (!response.ok) {
        throw new ApiError(
            response.status,
            `${options.method ?? 'GET'} ${url} failed with ${response.status}`,
        );
    }

    return (await response.json()) as T;
}

/** Multipart upload — the browser sets the Content-Type boundary itself. */
export async function apiUpload<T>(url: string, form: FormData): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken(),
        },
    });

    if (!response.ok) {
        // Lead with the status so failures are diagnosable even when the
        // body isn't JSON (e.g. a 413 from the web server, or an HTML 5xx
        // page). Only our own JSON error bodies carry a friendly message.
        const statusText = response.statusText || 'Upload failed';
        let message = `${response.status} ${statusText}`;

        try {
            const body = (await response.json()) as { message?: string };

            if (typeof body.message === 'string' && body.message !== '') {
                message = body.message;
            }
        } catch {
            // Non-JSON error body — keep the status-led message.
        }

        throw new ApiError(response.status, message);
    }

    return (await response.json()) as T;
}
