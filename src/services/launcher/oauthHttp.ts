import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/** OAuth endpoints must answer promptly; a stalled connection is never allowed to hang the app. */
export const OAUTH_REQUEST_TIMEOUT_MS = 30_000;

export function oauthAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

export function oauthTimeoutError(message: string): DOMException {
  return new DOMException(message, "TimeoutError");
}

export function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw oauthAbortError(message);
}

/** Waits for the next device-flow poll and wakes immediately when the user cancels. */
export function waitWithAbort(
  milliseconds: number,
  signal: AbortSignal | undefined,
  message: string,
): Promise<void> {
  throwIfAborted(signal, message);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(oauthAbortError(message));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs one OAuth operation under both caller cancellation and a hard total
 * deadline. The deadline is enforced by this promise, not only by the
 * underlying HTTP client, so a stalled body or a client that ignores abort
 * still cannot hang the flow forever.
 */
async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  throwIfAborted(signal, "OAuth request cancelled");

  const controller = new AbortController();
  let timedOut = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(oauthTimeoutError("OAuth request timed out — try again."));
    }, Math.max(1, timeoutMs));
  });

  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => {
      controller.abort(signal.reason);
      reject(oauthAbortError("OAuth request cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });

  try {
    return await Promise.race([operation(controller.signal), timeout, cancellation]);
  } catch (error) {
    if (timedOut) throw oauthTimeoutError("OAuth request timed out — try again.");
    if (signal?.aborted) throw oauthAbortError("OAuth request cancelled");
    throw error;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Tauri HTTP supports AbortSignal, but it has no total-request timeout.
 * This wrapper combines the caller's cancellation with a finite deadline.
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return runWithTimeout(
    (requestSignal) =>
      tauriFetch(url, {
        ...init,
        signal: requestSignal,
        connectTimeout: Math.min(timeoutMs, 15_000),
        maxRedirections: 0,
      }),
    signal,
    timeoutMs,
  );
}

/**
 * Fetches and reads the complete response under the same deadline. OAuth
 * responses are small, but reading a stalled body must not outlive the
 * request timeout.
 */
export async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; text: string }> {
  return runWithTimeout(
    async (requestSignal) => {
      const response = await tauriFetch(url, {
        ...init,
        signal: requestSignal,
        connectTimeout: Math.min(timeoutMs, 15_000),
        maxRedirections: 0,
      });
      const text = await response.text();
      return { response, text };
    },
    signal,
    timeoutMs,
  );
}
