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

/**
 * Multipart upload — the browser sets the Content-Type boundary itself.
 * `timeoutMs` aborts a stalled request so a hung transcription can't wedge the
 * upload queue forever (a wedged part is what tempts users into risky app
 * relaunches); on abort this throws and the caller retries later.
 */
export async function apiUpload<T>(
    url: string,
    form: FormData,
    options: { timeoutMs?: number } = {},
): Promise<T> {
    const controller =
        options.timeoutMs !== undefined ? new AbortController() : null;
    const timer =
        controller !== null
            ? setTimeout(() => controller.abort(), options.timeoutMs)
            : null;

    let response: Response;

    try {
        response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            body: form,
            signal: controller?.signal,
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-XSRF-TOKEN': xsrfToken(),
            },
        });
    } catch (error) {
        if (controller?.signal.aborted) {
            throw new ApiError(0, 'Upload timed out — will retry.');
        }

        throw error;
    } finally {
        if (timer !== null) {
            clearTimeout(timer);
        }
    }

    if (!response.ok) {
        // A 413 is raised by the web server (nginx) before Laravel runs, so
        // it never carries a JSON body — name the real cause instead of a
        // bare status code.
        let message =
            response.status === 413
                ? 'File too large — the server rejected the upload (raise its upload limit).'
                : `${response.status} ${response.statusText || 'Upload failed'}`;

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
