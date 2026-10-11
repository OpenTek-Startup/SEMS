import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthSession, AuthUser } from "./types";

/**
 * unknown      -> page just loaded, session not checked yet
 * authenticated-> we hold an access token
 * anonymous    -> not signed in (go to /login)
 * unreachable  -> could not ask the backend (offline / server down)
 */
export type AuthStatus = "unknown" | "authenticated" | "anonymous" | "unreachable";

export interface AuthState {
  status: AuthStatus;
  /**
   * Kept in memory only (never localStorage): a script injected into the
   * page cannot steal it from storage. A reload gets a new one from the
   * httpOnly refresh cookie.
   */
  accessToken: string | null;
  user: AuthUser | null;
  /** Why the user was signed out, shown on the sign-in page. */
  notice: string | null;
}

const initialState: AuthState = {
  status: "unknown",
  accessToken: null,
  user: null,
  notice: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<AuthSession>) {
      state.status = "authenticated";
      state.accessToken = action.payload.accessToken;
      state.user = action.payload.user;
      state.notice = null;
    },
    userUpdated(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
    },
    passwordChangeRequired(state) {
      if (state.user) state.user.mustChangePassword = true;
    },
    signedOut(state, action: PayloadAction<string | undefined>) {
      state.status = "anonymous";
      state.accessToken = null;
      state.user = null;
      state.notice = action.payload ?? null;
    },
    serverUnreachable(state) {
      state.status = "unreachable";
    },
    sessionCheckRetried(state) {
      state.status = "unknown";
    },
  },
});

export const {
  signedIn,
  userUpdated,
  passwordChangeRequired,
  signedOut,
  serverUnreachable,
  sessionCheckRetried,
} = authSlice.actions;

export default authSlice.reducer;
