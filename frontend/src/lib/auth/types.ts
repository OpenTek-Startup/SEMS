// Shapes returned by the backend /api/auth endpoints (see backend auth.controller.ts).

export type RoleArchetype = "admin" | "staff" | "parent" | "student";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  /** null for the platform Super Admin */
  school: { id: string; slug: string; name: string } | null;
  roles: { id: string; name: string; archetype: RoleArchetype | null }[];
  /** permission codes, e.g. "student.record.view" */
  permissions: string[];
}

export interface AuthSession {
  accessToken: string;
  /** access token lifetime, in seconds */
  expiresIn: number;
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
