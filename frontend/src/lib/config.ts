// Base URL of the YESE backend API (includes the /api prefix).
// Set NEXT_PUBLIC_API_URL in .env.local; this default matches the backend's dev port.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

// Development only: which school (tenant) the app talks to, sent as X-Tenant.
// In production the school comes from the subdomain (northfield.yese.app) and
// the backend ignores this header.
export const DEV_TENANT = process.env.NEXT_PUBLIC_TENANT ?? "northfield";
