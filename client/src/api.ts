export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
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
  return response.json() as Promise<T>;
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
