import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  BaseQueryApi,
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from "@reduxjs/toolkit/query";
import { API_URL, DEV_TENANT } from "@/lib/config";
import {
  passwordChangeRequired,
  serverUnreachable,
  signedIn,
  signedOut,
} from "@/lib/auth/authSlice";
import type { AuthSession } from "@/lib/auth/types";

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

/** The part of the store this file reads (avoids importing the store itself). */
interface StateWithAuth {
  auth?: { accessToken: string | null };
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_URL,
  // Sends the httpOnly refresh cookie to /auth/refresh and /auth/logout.
  credentials: "include",
  prepareHeaders: (headers, { getState }) => {
    if (DEV_TENANT) headers.set("X-Tenant", DEV_TENANT);
    const token = (getState() as StateWithAuth).auth?.accessToken;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

/** Auth calls that must never trigger an automatic refresh-and-retry. */
const NO_RETRY = ["/auth/login", "/auth/refresh", "/auth/logout"];

/** Sign-out reasons worth explaining on the sign-in page. */
const EXPLAINED = new Set([
  "SESSION_IDLE",
  "SESSION_EXPIRED",
  "SESSION_ENDED",
  "REFRESH_TOKEN_REUSED",
  "ACCOUNT_DISABLED",
  "WRONG_SCHOOL",
]);

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Trades the refresh cookie for a new access token. Many requests failing
 * with 401 at once share ONE refresh call (the token rotates on each call).
 * Resolves true when signed in again.
 */
export function refreshSession(api: BaseQueryApi): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const attempt = () =>
      rawBaseQuery({ url: "/auth/refresh", method: "POST" }, api, {});

    let result = await attempt();
    // Another tab may have rotated the token a moment ago; the browser
    // already holds the new cookie, so one retry is enough.
    if (apiErrorCode(result.error) === "REFRESH_TOKEN_INVALID") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = await attempt();
    }

    if (result.data) {
      api.dispatch(signedIn((result.data as ApiSuccess<AuthSession>).data));
      return true;
    }
    if (isNetworkError(result.error)) {
      api.dispatch(serverUnreachable());
      return false;
    }
    const code = apiErrorCode(result.error);
    api.dispatch(
      signedOut(code && EXPLAINED.has(code) ? apiErrorMessage(result.error) : undefined),
    );
    return false;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Base query with automatic re-authentication:
 * 401 -> refresh once -> retry the original request.
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);
  const url = typeof args === "string" ? args : args.url;

  if (result.error?.status === 401 && !NO_RETRY.includes(url)) {
    if (await refreshSession(api)) {
      result = await rawBaseQuery(args, api, extraOptions);
    }
  }

  if (
    result.error?.status === 403 &&
    apiErrorCode(result.error) === "PASSWORD_CHANGE_REQUIRED"
  ) {
    api.dispatch(passwordChangeRequired());
  }
  return result;
};

/**
 * Single RTK Query API for the whole app. Feature modules add their
 * endpoints with `baseApi.injectEndpoints(...)` in their own files.
 */
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
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

interface ApiErrorBody {
  code?: string;
  message?: string | string[];
}

function errorBody(error: unknown): ApiErrorBody | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return undefined;
  }
  const data = (error as { data?: Partial<ApiFailure> }).data;
  const body = data?.error;
  return typeof body === "object" && body !== null ? (body as ApiErrorBody) : undefined;
}

/** Stable error code from the backend, e.g. "INVALID_CREDENTIALS". */
export function apiErrorCode(error: unknown): string | undefined {
  return errorBody(error)?.code;
}

/** Human message from the backend, ready to show in the UI. */
export function apiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (isNetworkError(error)) {
    return "Cannot reach the YESE server. Check your connection and try again.";
  }
  const message = errorBody(error)?.message;
  if (Array.isArray(message)) return message.join(" ");
  return message || fallback;
}
