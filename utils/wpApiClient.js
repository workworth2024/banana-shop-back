function getBaseUrl() {
  return (process.env.WP_API_BASE_URL || '').replace(/\/+$/, '');
}
function getApiKey() {
  return process.env.WP_API_KEY || '';
}

export class WpApiError extends Error {
  constructor(message, { status, code, errors } = {}) {
    super(message);
    this.name = 'WpApiError';
    this.status = status || 500;
    this.code = code || 'WP_API_ERROR';
    this.errors = errors || null;
  }
}

/**
 * Server-to-server call to the WP External Partner API.
 * https://<wp-domain>/api/external/v1
 */
export async function wpRequest(method, path, { externalUserId, body, query, idempotencyKey } = {}) {
  const BASE_URL = getBaseUrl();
  const API_KEY = getApiKey();
  if (!BASE_URL || !API_KEY) {
    throw new WpApiError('White Pages integration is not configured (WP_API_BASE_URL / WP_API_KEY missing)', {
      status: 500,
      code: 'WP_NOT_CONFIGURED'
    });
  }
  if (!externalUserId) {
    throw new WpApiError('externalUserId is required', { status: 400, code: 'EXTERNAL_USER_ID_REQUIRED' });
  }

  let url = `${BASE_URL}${path}`;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    const qsStr = qs.toString();
    if (qsStr) url += `?${qsStr}`;
  }

  const headers = {
    'X-Api-Key': API_KEY,
    'X-External-User-Id': externalUserId,
    'Content-Type': 'application/json'
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new WpApiError('Failed to reach White Pages platform', { status: 502, code: 'WP_UNREACHABLE' });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || data?.success === false) {
    throw new WpApiError(data?.message || `WP API error (${res.status})`, {
      status: res.status,
      code: data?.code || 'WP_API_ERROR',
      errors: data?.errors || null
    });
  }

  return data?.data !== undefined ? data.data : data;
}

export const wpGet = (path, opts) => wpRequest('GET', path, opts);
export const wpPost = (path, opts) => wpRequest('POST', path, opts);

export function wpDownloadOrigin() {
  const BASE_URL = getBaseUrl();
  if (!BASE_URL) return '';
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return '';
  }
}

export default { wpRequest, wpGet, wpPost, wpDownloadOrigin, WpApiError };
