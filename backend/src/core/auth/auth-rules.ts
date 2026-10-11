/**
 * Pure authentication rules, kept free of Nest/Prisma so each one is unit-tested.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Failed sign-ins allowed per (email, IP, school) inside the window (NFR-SEC-04). */
export const MAX_FAILED_LOGINS = 5;
export const FAILED_LOGIN_WINDOW_MINUTES = 15;

/** Two browser tabs refreshing at the same moment is not an attack. */
export const REFRESH_REUSE_GRACE_SECONDS = 30;

/** Write `lastActiveAt` at most once a minute, not on every request. */
export const ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

export const REFRESH_COOKIE = 'yese_rt';
export const REFRESH_COOKIE_PATH = '/api/auth';

/** "15m" -> 900, "900" -> 900, "1h" -> 3600, "1d" -> 86400. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration "${value}" (use e.g. 15m, 900, 1h)`);
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const factor = factors[unit] ?? 1;
  const seconds = amount * factor;
  if (seconds <= 0) throw new Error(`Duration "${value}" must be greater than zero`);
  return seconds;
}

/** Emails are compared lower-case and trimmed (the seed stores them that way). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A new opaque refresh token: 256 random bits, URL-safe. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored, so a database leak does not leak live tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** "Bearer abc" -> "abc". */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/** Reads one cookie from a raw Cookie header (no cookie-parser needed). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/** True when the session has had no authenticated request for too long. */
export function isIdle(lastActiveAt: Date, now: Date, idleMinutes: number): boolean {
  return now.getTime() - lastActiveAt.getTime() > idleMinutes * 60_000;
}

/**
 * Password policy. Returns readable problems; an empty list means "accepted".
 * Kept modest on purpose (school staff, shared devices): length matters most.
 */
export function passwordProblems(
  password: string,
  context: { email?: string; currentPassword?: string } = {},
): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push('Use at least 8 characters.');
  if (password.length > 128) problems.push('Use at most 128 characters.');
  if (!/[A-Za-z]/.test(password)) problems.push('Include at least one letter.');
  if (!/\d/.test(password)) problems.push('Include at least one number.');
  if (context.currentPassword !== undefined && password === context.currentPassword) {
    problems.push('Choose a password different from the current one.');
  }
  if (context.email && password.toLowerCase() === normalizeEmail(context.email)) {
    problems.push('Do not use your email address as your password.');
  }
  return problems;
}

// ------------------------------------------------------------ user view

/** The signed-in user as returned by /auth/login, /auth/refresh and /auth/me. */
export interface AuthUserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  school: { id: string; slug: string; name: string } | null;
  roles: { id: string; name: string; archetype: string | null }[];
  permissions: string[];
}

/** Shape of the database row loaded by AuthService (see USER_VIEW_SELECT). */
export interface UserViewRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  tenant: { id: string; slug: string; name: string } | null;
  roles: {
    role: {
      id: string;
      name: string;
      archetype: string | null;
      permissions: { permission: { code: string } }[];
    };
  }[];
}

/** Flattens roles -> permissions into a sorted, de-duplicated list of codes. */
export function toAuthUserView(row: UserViewRow): AuthUserView {
  const permissions = new Set<string>();
  for (const { role } of row.roles) {
    for (const { permission } of role.permissions) permissions.add(permission.code);
  }
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    isSuperAdmin: row.isSuperAdmin,
    mustChangePassword: row.mustChangePassword,
    school: row.tenant ? { id: row.tenant.id, slug: row.tenant.slug, name: row.tenant.name } : null,
    roles: row.roles
      .map(({ role }) => ({ id: role.id, name: role.name, archetype: role.archetype }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    permissions: [...permissions].sort((a, b) => a.localeCompare(b)),
  };
}
