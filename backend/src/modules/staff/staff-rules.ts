/**
 * Pure rules of the Staff module, kept free of Nest/Prisma so every rule is
 * unit-tested. Checks return a Problem (or null); the service picks the HTTP status.
 */
import { formatDay } from '../academic/academic-rules';

export interface Problem {
  code: string;
  message: string;
  [extra: string]: unknown;
}

export type StaffCategory = 'teaching' | 'non_teaching';
export type StaffStatus = 'active' | 'inactive';

export const STAFF_NUMBER_PREFIX = 'STF-';
const STAFF_NUMBER = /^[A-Z0-9][A-Z0-9/-]{1,19}$/;
const GENERATED = /^STF-(\d+)$/;

// -------------------------------------------------------------- text

/** Trims and collapses inner spaces: "  Ngwa   Brenda " -> "Ngwa Brenda". */
export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** "  stf 0007 " -> "STF0007"; null when it cannot be a staff number. */
export function normalizeStaffNumber(value: string): string | null {
  const v = value.trim().toUpperCase().replace(/\s+/g, '');
  return STAFF_NUMBER.test(v) ? v : null;
}

/** The next free generated number: STF-0001, STF-0002, … (never reuses a gap). */
export function nextStaffNumber(existing: readonly string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = GENERATED.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${STAFF_NUMBER_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

/**
 * Phone numbers as people type them: "+237 677 12 34 56", "677-123-456".
 * Keeps digits, spaces, "+", "-", "(" and ")"; needs 8 to 15 digits.
 * Returns the tidied number, or null when it is not a phone number.
 */
export function normalizePhone(value: string): string | null {
  const v = cleanText(value);
  if (!/^\+?[\d\s()-]+$/.test(v)) return null;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 8 && digits <= 15 ? v : null;
}

/** Lower-case, accents removed: used to search names without caring how they were typed. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// -------------------------------------------------------------- views

export interface StaffRow {
  id: string;
  staffNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string;
  category: string;
  status: string;
  hireDate: Date | null;
  userId: string | null;
}

export interface LinkedAccount {
  id: string;
  email: string;
  status: string;
}

export interface StaffView {
  id: string;
  staffNumber: string;
  firstName: string;
  lastName: string;
  /** "Ngwa Brenda" (last name first, as on school lists) */
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string;
  category: StaffCategory;
  status: StaffStatus;
  /** "2024-09-02" or null */
  hireDate: string | null;
  /** the user account this person signs in with, if any */
  account: LinkedAccount | null;
}

export function toStaffView(row: StaffRow, accounts: ReadonlyMap<string, LinkedAccount>): StaffView {
  return {
    id: row.id,
    staffNumber: row.staffNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.lastName} ${row.firstName}`,
    email: row.email,
    phone: row.phone,
    position: row.position,
    category: row.category as StaffCategory,
    status: row.status as StaffStatus,
    hireDate: row.hireDate ? formatDay(row.hireDate) : null,
    account: row.userId ? (accounts.get(row.userId) ?? null) : null,
  };
}

/** By last name, then first name (case- and accent-insensitive), then staff number. */
export function byName(a: StaffView, b: StaffView): number {
  return (
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }) ||
    a.staffNumber.localeCompare(b.staffNumber)
  );
}

export interface StaffFilter {
  search?: string;
  status?: StaffStatus;
  category?: StaffCategory;
}

/**
 * Every word of the search must appear in the name, staff number, position,
 * email or phone: "brenda math" finds "Ngwa Brenda, Mathematics teacher".
 */
export function matchesSearch(view: StaffView, search: string): boolean {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(
    [view.firstName, view.lastName, view.staffNumber, view.position, view.email ?? '', view.phone ?? ''].join(' '),
  );
  return words.every((w) => haystack.includes(w));
}

export function filterStaff(views: readonly StaffView[], filter: StaffFilter): StaffView[] {
  return views
    .filter((v) => !filter.status || v.status === filter.status)
    .filter((v) => !filter.category || v.category === filter.category)
    .filter((v) => !filter.search || matchesSearch(v, filter.search))
    .sort(byName);
}

/** Fields that differ between two versions of a record (for the audit trail). */
export function changedFields<T extends object>(before: T, after: T): string[] {
  return (Object.keys(after) as (keyof T)[])
    .filter((k) => {
      const a = before[k];
      const b = after[k];
      if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
      return a !== b;
    })
    .map(String)
    .sort();
}
