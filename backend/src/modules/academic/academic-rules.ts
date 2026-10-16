/**
 * Pure rules of the academic structure (years, terms, classes, sections,
 * subjects), kept free of Nest/Prisma so every rule is unit-tested.
 *
 * Checks return a Problem (or null) instead of throwing: the service
 * decides the HTTP status.
 */

/** A rule that failed: a stable code for the frontend, a message for people. */
export interface Problem {
  code: string;
  message: string;
  [extra: string]: unknown;
}

/** A school year longer than this is almost surely a typo (2026 vs 2027). */
export const MAX_YEAR_DAYS = 550;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// ------------------------------------------------------------------ dates

/**
 * "2026-09-07" -> Date at 00:00 UTC, or null if the text is not a real
 * calendar day (2026-02-30 is refused).
 */
export function parseDay(value: string): Date | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/** Date -> "2026-09-07" (the API always speaks in calendar days). */
export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today as a calendar day (UTC). */
export function today(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface DayRange {
  startDate: Date;
  endDate: Date;
}

/** Both ends included: a term ending on 12 Dec and one starting on 12 Dec overlap. */
export function overlaps(a: DayRange, b: DayRange): boolean {
  return a.startDate.getTime() <= b.endDate.getTime() && b.startDate.getTime() <= a.endDate.getTime();
}

export function contains(outer: DayRange, inner: DayRange): boolean {
  return (
    outer.startDate.getTime() <= inner.startDate.getTime() && inner.endDate.getTime() <= outer.endDate.getTime()
  );
}

/** The end must come after the start. */
export function checkRange(range: DayRange): Problem | null {
  if (range.endDate.getTime() <= range.startDate.getTime()) {
    return { code: 'DATES_INVALID', message: 'The end date must be after the start date.' };
  }
  return null;
}

export function checkYearLength(range: DayRange): Problem | null {
  const days = Math.round((range.endDate.getTime() - range.startDate.getTime()) / DAY_MS);
  if (days > MAX_YEAR_DAYS) {
    return {
      code: 'YEAR_TOO_LONG',
      message: `An academic year cannot last more than ${MAX_YEAR_DAYS} days. Check the dates.`,
    };
  }
  return null;
}

/** First item of `others` (except `ignoreId`) whose dates overlap `range`. */
export function findOverlap<T extends DayRange & { id: string }>(
  range: DayRange,
  others: readonly T[],
  ignoreId?: string,
): T | undefined {
  return others.find((o) => o.id !== ignoreId && overlaps(range, o));
}

/** Names of the terms that would no longer fit inside the year's new dates. */
export function termsOutside(year: DayRange, terms: readonly (DayRange & { name: string })[]): string[] {
  return terms.filter((t) => !contains(year, t)).map((t) => t.name);
}

// ------------------------------------------------------------------ names

/** Trims and collapses inner spaces: "  Form   1 " -> "Form 1". */
export function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Names are unique per school without regard to case ("form 1" = "Form 1"). */
export function sameName(a: string, b: string): boolean {
  return cleanName(a).localeCompare(cleanName(b), undefined, { sensitivity: 'base' }) === 0;
}

/** The first item of `others` (except `ignoreId`) that already uses `name`. */
export function nameTaken<T extends { id: string }>(
  name: string,
  others: readonly T[],
  nameOf: (item: T) => string,
  ignoreId?: string,
): T | undefined {
  return others.find((o) => o.id !== ignoreId && sameName(nameOf(o), name));
}

const SUBJECT_CODE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

/** " math " -> "MATH". Returns null when the code is not 1–12 letters, digits or dashes. */
export function normalizeSubjectCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return SUBJECT_CODE.test(code) ? code : null;
}

/** Values that appear more than once. */
export function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

/** Natural order: "Form 2" before "Form 10", "A" before "B". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** "Form 1" + "A" -> "Form 1 A". */
export function sectionLabel(className: string, sectionName: string): string {
  return `${className} ${sectionName}`;
}

// ------------------------------------------------------------------ views

export interface YearRow extends DayRange {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface TermRow extends DayRange {
  id: string;
  academicYearId: string;
  name: string;
}

export interface TermView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** today falls inside this term of the current year */
  isCurrent: boolean;
}

export interface YearView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  terms: TermView[];
}

/** Years newest first, each with its terms in date order. */
export function toYearViews(years: readonly YearRow[], terms: readonly TermRow[], now: Date = new Date()): YearView[] {
  const day = today(now).getTime();
  return [...years]
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
    .map((y) => ({
      id: y.id,
      name: y.name,
      startDate: formatDay(y.startDate),
      endDate: formatDay(y.endDate),
      isCurrent: y.isCurrent,
      terms: terms
        .filter((t) => t.academicYearId === y.id)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
        .map((t) => ({
          id: t.id,
          name: t.name,
          startDate: formatDay(t.startDate),
          endDate: formatDay(t.endDate),
          isCurrent: y.isCurrent && t.startDate.getTime() <= day && day <= t.endDate.getTime(),
        })),
    }));
}

export interface ClassRow {
  id: string;
  name: string;
  level: number;
}

export interface SectionRow {
  id: string;
  classId: string;
  name: string;
  capacity: number | null;
}

export interface SubjectRow {
  id: string;
  code: string;
  name: string;
}

export interface ClassSubjectRow {
  classId: string;
  subjectId: string;
  coefficient: number;
}

export interface SectionView {
  id: string;
  name: string;
  /** e.g. "Form 1 A" */
  label: string;
  capacity: number | null;
}

export interface ClassView {
  id: string;
  name: string;
  level: number;
  sections: SectionView[];
  subjects: { subjectId: string; code: string; name: string; coefficient: number }[];
  totalCoefficient: number;
}

export function byLevel(a: ClassRow, b: ClassRow): number {
  return a.level - b.level || naturalCompare(a.name, b.name);
}

/** Classes in level order, each with its sections and its subjects (coefficients). */
export function assembleClasses(
  classes: readonly ClassRow[],
  sections: readonly SectionRow[],
  classSubjects: readonly ClassSubjectRow[],
  subjects: readonly SubjectRow[],
): ClassView[] {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  return [...classes].sort(byLevel).map((c) => {
    const list = classSubjects
      .filter((cs) => cs.classId === c.id)
      .map((cs) => {
        const subject = subjectById.get(cs.subjectId);
        return subject
          ? { subjectId: subject.id, code: subject.code, name: subject.name, coefficient: cs.coefficient }
          : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => naturalCompare(a.name, b.name));
    return {
      id: c.id,
      name: c.name,
      level: c.level,
      sections: sections
        .filter((s) => s.classId === c.id)
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((s) => ({ id: s.id, name: s.name, label: sectionLabel(c.name, s.name), capacity: s.capacity })),
      subjects: list,
      totalCoefficient: list.reduce((sum, s) => sum + s.coefficient, 0),
    };
  });
}

export interface SubjectView extends SubjectRow {
  /** how many classes study this subject */
  classCount: number;
}

export function toSubjectViews(subjects: readonly SubjectRow[], classSubjects: readonly ClassSubjectRow[]): SubjectView[] {
  return [...subjects]
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      classCount: classSubjects.filter((cs) => cs.subjectId === s.id).length,
    }));
}

/** Flat list of every section, for pickers (enrollment, registers, assignments). */
export interface SectionListItem extends SectionView {
  classId: string;
  className: string;
  level: number;
}

export function toSectionList(classes: readonly ClassRow[], sections: readonly SectionRow[]): SectionListItem[] {
  return assembleClasses(classes, sections, [], []).flatMap((c) =>
    c.sections.map((s) => ({ ...s, classId: c.id, className: c.name, level: c.level })),
  );
}
