export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;
  const writing = !["GET", "HEAD"].includes(
    (options.method ?? "GET").toUpperCase(),
  );
  const writeNotice = writing
    ? "Your changes may have been saved. Check the project before trying again."
    : "Please try again.";
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        error?.message ?? "Could not reach Bartleby. Please try again.",
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (reason) {
    if (options.signal?.aborted) throw reason;
    if (timeout.signal.aborted)
      throw new Error(`Bartleby took too long to respond. ${writeNotice}`);
    if (reason instanceof TypeError)
      throw new Error(`Could not reach Bartleby. ${writeNotice}`);
    throw reason;
  } finally {
    window.clearTimeout(timer);
  }
}

export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export function readPreference(key: string) {
  try {
    return localStorage.getItem(`bartleby.${key}`);
  } catch {
    return null;
  }
}

export function savePreference(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(`bartleby.${key}`);
    else localStorage.setItem(`bartleby.${key}`, value);
  } catch {
    /* The app still works when browser storage is disabled. */
  }
}
