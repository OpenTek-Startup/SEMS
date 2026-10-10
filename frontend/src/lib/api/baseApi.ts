import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { API_URL } from "@/lib/config";

/** Every successful backend response is wrapped by its TransformInterceptor. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Every failed backend response comes from its AllExceptionsFilter. */
export interface ApiFailure {
  success: false;
  statusCode: number;
  path: string;
  timestamp: string;
  error: unknown;
}

/**
 * Single RTK Query API for the whole app. Feature modules add their
 * endpoints with `baseApi.injectEndpoints(...)` in their own files.
 */
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: API_URL,
    credentials: "include",
  }),
  tagTypes: [],
  endpoints: () => ({}),
});

/** True when the browser could not reach the backend at all. */
export function isNetworkError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as FetchBaseQueryError).status === "FETCH_ERROR"
  );
}

/** HTTP status of a failed request, if the backend answered. */
export function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as FetchBaseQueryError).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}
