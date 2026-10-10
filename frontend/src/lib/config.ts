// Base URL of the YESE backend API (includes the /api prefix).
// Set NEXT_PUBLIC_API_URL in .env.local; this default matches the backend's dev port.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
