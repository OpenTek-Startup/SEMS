import { baseApi, refreshSession, type ApiSuccess } from "./baseApi";
import { signedIn, signedOut, userUpdated } from "@/lib/auth/authSlice";
import type {
  AuthSession,
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
} from "@/lib/auth/types";

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<AuthSession, LoginRequest>({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
      transformResponse: (response: ApiSuccess<AuthSession>) => response.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(signedIn(data));
        } catch {
          // The sign-in form shows the error.
        }
      },
    }),

    /** On page load: is there still a session (refresh cookie)? */
    restoreSession: build.mutation<boolean, void>({
      queryFn: async (_arg, api) => ({ data: await refreshSession(api) }),
    }),

    logout: build.mutation<void, void>({
      query: () => ({ url: "/auth/logout", method: "POST" }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch {
          // Signed out locally anyway.
        }
        dispatch(signedOut());
        // Drop every cached response that belonged to this user.
        dispatch(baseApi.util.resetApiState());
      },
    }),

    changePassword: build.mutation<AuthUser, ChangePasswordRequest>({
      query: (body) => ({ url: "/auth/change-password", method: "POST", body }),
      transformResponse: (response: ApiSuccess<AuthUser>) => response.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(userUpdated(data));
        } catch {
          // The form shows the error.
        }
      },
    }),
  }),
});

export const {
  useLoginMutation,
  useRestoreSessionMutation,
  useLogoutMutation,
  useChangePasswordMutation,
} = authApi;
