import { useAppSelector } from "@/store/hooks";
import type { AuthUser } from "./types";

/**
 * Permission codes the frontend uses. The backend is the authority
 * (@RequirePermission on each route); the UI only hides what would fail.
 */
export const PERMISSIONS = {
  userView: "core.user.view",
  userManage: "core.user.manage",
  roleManage: "core.role.manage",
  auditView: "core.audit.view",
} as const;

/** True when the user holds every listed permission. */
export function can(user: AuthUser | null | undefined, ...codes: string[]): boolean {
  if (!user) return false;
  return codes.every((code) => user.permissions.includes(code));
}

/** Same as can(), for the signed-in user. */
export function useCan(...codes: string[]): boolean {
  const user = useAppSelector((state) => state.auth.user);
  return can(user, ...codes);
}
