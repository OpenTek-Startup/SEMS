/**
 * Pure rules for user administration, kept free of Nest/Prisma so they are unit-tested.
 */
import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: temporary passwords are read aloud or copied by hand.
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALPHABET = LETTERS + DIGITS;

/**
 * A one-time password for a new or reset account, e.g. "Kp7m-x9Qa-2Rbt".
 * Always has letters and digits, so it passes the password policy; the user
 * must replace it at first sign-in (mustChangePassword = true).
 */
export function generateTemporaryPassword(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  // Guarantee at least one letter and one digit at random positions.
  const letterAt = randomInt(12);
  let digitAt = randomInt(12);
  while (digitAt === letterAt) digitAt = randomInt(12);
  chars[letterAt] = LETTERS[randomInt(LETTERS.length)];
  chars[digitAt] = DIGITS[randomInt(DIGITS.length)];
  const s = chars.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Ids, de-duplicated, in a stable order. */
export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** A user as shown in the school's user list. */
export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: { id: string; name: string; archetype: string | null }[];
}

/** Database row shape loaded with USER_LIST_SELECT. */
export interface UserListRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: { role: { id: string; name: string; archetype: string | null } }[];
}

export function toUserListItem(row: UserListRow): UserListItem {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    roles: row.roles
      .map(({ role }) => ({ id: role.id, name: role.name, archetype: role.archetype }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Sorts users by last name, then first name (case-insensitive). */
export function byName(a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }) {
  return (
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
  );
}
