/**
 * Works out which school a request is for (SRS FR-PL-01).
 *
 *  - Development / tests: the `X-Tenant` header, e.g. `X-Tenant: northfield`.
 *  - Production: the first label of the host name, e.g. `northfield.yese.app`
 *    or `northfield.localhost`. The header is ignored in production so a
 *    client cannot pick another school by changing a header.
 *
 * Returns the lower-cased slug, or undefined when the request names no school
 * (e.g. /api/health, or platform-level Super Admin routes).
 */

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform']);

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && !RESERVED.has(value);
}

export function slugFromHost(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const hostname = host.split(':')[0].toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return undefined; // IPv4
  const labels = hostname.split('.');
  // "northfield.localhost" (2 labels) or "northfield.yese.app" (3+ labels)
  const isLocal = labels.length === 2 && labels[1] === 'localhost';
  if (!isLocal && labels.length < 3) return undefined;
  const candidate = labels[0];
  return isValidSlug(candidate) ? candidate : undefined;
}

export function resolveTenantSlug(params: {
  headerValue: string | string[] | undefined;
  host: string | undefined;
  allowHeader: boolean;
}): string | undefined {
  if (params.allowHeader && params.headerValue !== undefined) {
    const raw = Array.isArray(params.headerValue)
      ? params.headerValue[0]
      : params.headerValue;
    const slug = raw?.trim().toLowerCase();
    if (slug) return slug; // validated by the caller (unknown -> 404)
  }
  return slugFromHost(params.host);
}
