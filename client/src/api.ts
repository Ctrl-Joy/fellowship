export class ApiError extends Error {
  /** `details` is the whole `error` object from the response (e.g. `retryAfter` on 429s). */
  constructor(public status: number, public code: string, message: string, public details?: Record<string, any>) {
    super(message);
  }
}

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server');
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err ?? undefined);
  }
  return data as T;
}

/** JSON fetch wrapper. Paths are absolute (`/api/...`). Throws ApiError on 4xx/5xx. */
export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T = any>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  put: <T = any>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T = any>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  /** multipart upload: pass a FormData. */
  upload: <T = any>(path: string, form: FormData) => request<T>('POST', path, form),
};
