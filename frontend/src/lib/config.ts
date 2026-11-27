// Base URL of the YESE backend API (includes the /api prefix).
// Set NEXT_PUBLIC_API_URL in .env.local; this default matches the backend's dev port.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

// Development only: which school (tenant) the app talks to, sent as X-Tenant.
// In production the school comes from the subdomain (northfield.yese.app) and
// the backend ignores this header.
export const DEV_TENANT = process.env.NEXT_PUBLIC_TENANT ?? "northfield";

// Development only: the sign-in page can switch school (or the platform) in this
// browser without editing .env.local. The choice is kept in localStorage; it is
// only a school name, never a token.
export const DEV_TENANT_SWITCH = process.env.NODE_ENV !== "production";
const DEV_TENANT_KEY = "yese.devTenant";

/** The school sent as X-Tenant: the one chosen on the sign-in page, else NEXT_PUBLIC_TENANT. "" means the platform. */
export function devTenant(): string {
  if (!DEV_TENANT_SWITCH || typeof window === "undefined") return DEV_TENANT;
  try {
    return window.localStorage.getItem(DEV_TENANT_KEY) ?? DEV_TENANT;
  } catch {
    return DEV_TENANT;
  }
}

/** Chooses the school for this browser; null goes back to NEXT_PUBLIC_TENANT. */
export function setDevTenant(slug: string | null): void {
  try {
    if (slug === null) window.localStorage.removeItem(DEV_TENANT_KEY);
    else window.localStorage.setItem(DEV_TENANT_KEY, slug);
  } catch {
    // Storage blocked: the browser keeps NEXT_PUBLIC_TENANT.
  }
}
