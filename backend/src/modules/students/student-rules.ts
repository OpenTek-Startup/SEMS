/**
 * Pure rules of the Students module, kept free of Nest/Prisma so every rule
 * is unit-tested. Checks return a Problem (or null); the service picks the
 * HTTP status.
 */
import { formatDay } from '../academic/academic-rules';
import { changedFields, cleanText, fold, normalizePhone, type Problem } from '../staff/staff-rules';

export { changedFields, cleanText, normalizePhone, type Problem };

export type Gender = 'male' | 'female';
export type StudentStatus = 'active' | 'inactive';

export const MATRICULE_PREFIX = 'STU-';
const MATRICULE = /^[A-Z0-9][A-Z0-9/-]{1,19}$/;
const GENERATED = /^STU-(\d+)$/;

/** "  nf/2026/ 014 " -> "NF/2026/014"; null when it cannot be a matricule. */
export function normalizeMatricule(value: string): string | null {
  const v = value.trim().toUpperCase().replace(/\s+/g, '');
  return MATRICULE.test(v) ? v : null;
}

/** The next free generated matricule: STU-0001, STU-0002, … (never reuses a gap). */
export function nextMatricule(existing: readonly string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = GENERATED.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${MATRICULE_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

/** Born at least 2 and at most 40 years before today (catches typos such as 2062 or 1926). */
export function checkDateOfBirth(born: Date, today: Date): Problem | null {
  const age = (today.getTime() - born.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 2 || age > 40) {
    return { code: 'DATE_OF_BIRTH_INVALID', message: `${formatDay(born)} does not look like a student's date of birth.` };
  }
  return null;
}

// -------------------------------------------------------------- views

export interface StudentRow {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: Date | null;
  placeOfBirth: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelationship: string | null;
  status: string;
  admittedOn: Date | null;
}

/** Where the student is in the current year, if enrolled. */
export interface CurrentPlace {
  enrollmentId: string;
  yearId: string;
  sectionId: string;
  /** "Form 1 A" */
  label: string;
}

export interface StudentView {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  /** "Abena Ada" (last name first, as on class lists) */
  fullName: string;
  gender: Gender;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  guardian: { name: string | null; phone: string | null; relationship: string | null } | null;
  status: StudentStatus;
  admittedOn: string | null;
  current: CurrentPlace | null;
}

export function toStudentView(row: StudentRow, current: CurrentPlace | null): StudentView {
  const hasGuardian = row.guardianName || row.guardianPhone || row.guardianRelationship;
  return {
    id: row.id,
    matricule: row.matricule,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.lastName} ${row.firstName}`,
    gender: row.gender as Gender,
    dateOfBirth: row.dateOfBirth ? formatDay(row.dateOfBirth) : null,
    placeOfBirth: row.placeOfBirth,
    guardian: hasGuardian
      ? { name: row.guardianName, phone: row.guardianPhone, relationship: row.guardianRelationship }
      : null,
    status: row.status as StudentStatus,
    admittedOn: row.admittedOn ? formatDay(row.admittedOn) : null,
    current,
  };
}

/** By last name, then first name (case- and accent-insensitive), then matricule. */
export function byStudentName(
  a: { lastName: string; firstName: string; matricule: string },
  b: { lastName: string; firstName: string; matricule: string },
): number {
  return (
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }) ||
    a.matricule.localeCompare(b.matricule)
  );
}

export interface StudentFilter {
  search?: string;
  status?: StudentStatus;
  /** students of this section in the current year */
  sectionId?: string;
  /** true: only students with no class in the current year */
  unplaced?: boolean;
}

/** Every word must appear in the name, matricule or guardian: "ada nf26" finds "Abena Ada, NF26-0001". */
export function matchesStudent(view: StudentView, search: string): boolean {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(
    [view.firstName, view.lastName, view.matricule, view.guardian?.name ?? '', view.guardian?.phone ?? ''].join(' '),
  );
  return words.every((w) => haystack.includes(w));
}

export function filterStudents(views: readonly StudentView[], filter: StudentFilter): StudentView[] {
  return views
    .filter((v) => !filter.status || v.status === filter.status)
    .filter((v) => !filter.sectionId || v.current?.sectionId === filter.sectionId)
    .filter((v) => !filter.unplaced || v.current === null)
    .filter((v) => !filter.search || matchesStudent(v, filter.search))
    .sort(byStudentName);
}
