export class ApiError extends Error {
  constructor(message: string, readonly status?: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiError'
  }
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

export async function apiRequest<T>(path: `/api/${string}`, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { credentials: 'same-origin', ...init, headers })
  } catch (cause) {
    if (init.signal?.aborted) throw cause
    throw new ApiError('Could not reach the Comforce API.', undefined, { cause })
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail
      : Array.isArray(body?.detail) ? body.detail.map((item: { msg: string }) => item.msg).join(' ') : undefined
    throw new ApiError(detail || 'The ComForce API rejected the request.', response.status)
  }
  try {
    return await response.json() as T
  } catch (cause) {
    throw new ApiError('The Comforce API returned an invalid JSON response.', response.status, { cause })
  }
}
