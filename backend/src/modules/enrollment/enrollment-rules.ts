/**
 * Pure rules of the Enrollment module, kept free of Nest/Prisma so every
 * rule is unit-tested. Checks return a Problem (or null); the service picks
 * the HTTP status.
 *
 * An enrollment places one student in one section for one school year.
 * A student has at most one active enrollment per year. A transfer closes
 * the old row (status transferred, leftOn) and opens a new one; a
 * withdrawal closes it (withdrawn). Closed rows stay as history.
 */
import { formatDay } from '../academic/academic-rules';
import type { Problem } from '../staff/staff-rules';

export type { Problem };

export type EnrollmentStatus = 'active' | 'transferred' | 'withdrawn';

export interface YearRange {
  name: string;
  startDate: Date;
  endDate: Date;
}

/** The day to use when none is given: today, kept inside the school year. */
export function defaultDay(year: YearRange, today: Date): Date {
  if (today.getTime() < year.startDate.getTime()) return year.startDate;
  if (today.getTime() > year.endDate.getTime()) return year.endDate;
  return today;
}

export function checkInYear(day: Date, year: YearRange): Problem | null {
  if (day.getTime() < year.startDate.getTime() || day.getTime() > year.endDate.getTime()) {
    return {
      code: 'DATE_OUTSIDE_YEAR',
      message: `${formatDay(day)} is outside the school year ${year.name} (${formatDay(year.startDate)} to ${formatDay(year.endDate)}).`,
    };
  }
  return null;
}

/** A student cannot leave a section before the day they joined it. */
export function checkNotBefore(day: Date, enrolledOn: Date): Problem | null {
  if (day.getTime() < enrolledOn.getTime()) {
    return {
      code: 'DATE_BEFORE_ENROLLMENT',
      message: `${formatDay(day)} is before the student joined this class (${formatDay(enrolledOn)}).`,
    };
  }
  return null;
}

/** null capacity = no limit. */
export function checkCapacity(label: string, capacity: number | null, current: number, adding: number): Problem | null {
  if (capacity === null || current + adding <= capacity) return null;
  const free = Math.max(0, capacity - current);
  return {
    code: 'SECTION_FULL',
    message:
      free === 0
        ? `${label} is full (${capacity} places).`
        : `${label} has only ${free} free place${free === 1 ? '' : 's'} (capacity ${capacity}).`,
    capacity,
    free,
  };
}

/** Each student id once; the duplicates are reported. */
export function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

// -------------------------------------------------------------- views

export interface EnrollmentRow {
  id: string;
  academicYearId: string;
  studentId: string;
  sectionId: string;
  status: string;
  enrolledOn: Date;
  leftOn: Date | null;
  reason: string | null;
}

export interface RosterStudent {
  studentId: string;
  matricule: string;
  firstName: string;
  lastName: string;
  gender: string;
}

export interface EnrollmentView {
  id: string;
  yearId: string;
  status: EnrollmentStatus;
  enrolledOn: string;
  leftOn: string | null;
  reason: string | null;
  section: { id: string; label: string };
  student: { id: string; matricule: string; fullName: string; gender: string };
}

export function toEnrollmentView(
  row: EnrollmentRow,
  students: ReadonlyMap<string, RosterStudent>,
  labels: ReadonlyMap<string, string>,
): EnrollmentView {
  const s = students.get(row.studentId);
  return {
    id: row.id,
    yearId: row.academicYearId,
    status: row.status as EnrollmentStatus,
    enrolledOn: formatDay(row.enrolledOn),
    leftOn: row.leftOn ? formatDay(row.leftOn) : null,
    reason: row.reason,
    section: { id: row.sectionId, label: labels.get(row.sectionId) ?? '?' },
    student: {
      id: row.studentId,
      matricule: s?.matricule ?? '?',
      fullName: s ? `${s.lastName} ${s.firstName}` : '?',
      gender: s?.gender ?? '?',
    },
  };
}

/** Active first, then by name. */
export function sortEnrollments(views: readonly EnrollmentView[]): EnrollmentView[] {
  const order: Record<EnrollmentStatus, number> = { active: 0, transferred: 1, withdrawn: 2 };
  return [...views].sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      a.student.fullName.localeCompare(b.student.fullName, undefined, { sensitivity: 'base' }) ||
      a.student.matricule.localeCompare(b.student.matricule),
  );
}

export interface SectionCount {
  sectionId: string;
  classId: string;
  label: string;
  capacity: number | null;
  /** active enrollments */
  enrolled: number;
  boys: number;
  girls: number;
}

/** One line per section (in class order) with its active enrollments. */
export function countBySection(
  sections: readonly { id: string; classId: string; label: string; capacity: number | null }[],
  active: readonly { sectionId: string; gender: string }[],
): SectionCount[] {
  return sections.map((s) => {
    const mine = active.filter((a) => a.sectionId === s.id);
    return {
      sectionId: s.id,
      classId: s.classId,
      label: s.label,
      capacity: s.capacity,
      enrolled: mine.length,
      boys: mine.filter((m) => m.gender === 'male').length,
      girls: mine.filter((m) => m.gender === 'female').length,
    };
  });
}

/** The class list of a section: students sorted by name (used by Assessment and Attendance). */
export function toRoster(students: readonly RosterStudent[]): (RosterStudent & { fullName: string })[] {
  return [...students]
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
        a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }) ||
        a.matricule.localeCompare(b.matricule),
    )
    .map((s) => ({ ...s, fullName: `${s.lastName} ${s.firstName}` }));
}
