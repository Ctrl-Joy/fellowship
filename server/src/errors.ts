export class HttpError extends Error {
  /** `details` are merged into the JSON error body (e.g. `{ retryAfter }`). */
  constructor(public statusCode: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message);
export const unauthorized = (message = 'Not signed in') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
