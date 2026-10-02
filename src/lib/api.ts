let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined) {
  csrfToken = token || null;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch(url: string, init: RequestInit = {}) {
  const needsCsrf = csrfToken && !["GET", "HEAD", "OPTIONS"].includes((init.method || "GET").toUpperCase());
  if (!needsCsrf) return fetch(url, { ...init, credentials: "include" });

  const headers = new Headers(init.headers);
  headers.set("X-CSRF-Token", csrfToken);
  return fetch(url, { ...init, headers, credentials: "include" });
}

export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(url, init);
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data && typeof data.error === "string"
      ? data.error
      : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}
