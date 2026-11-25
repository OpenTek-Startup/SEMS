/**
 * Pure rules for marks (scores of students in one assessment). No Nest or
 * Prisma here, so every rule is unit-tested. Checks return a Problem (or
 * null); the service picks the HTTP status.
 *
 * A mark is a score from 0 to the assessment's maxScore with at most two
 * decimals ("12,5" and "12.5" both work), or "absent". A student with
 * neither has not been marked yet: allowed while the teacher works, but the
 * assessment cannot be submitted until every student has one or the other.
 */
import type { Problem } from '../staff/staff-rules';
import type { AssessmentStatus } from './assessment-rules';

export type { Problem };

/** What the teacher typed: a number, or text from a cell ("12,5", "abs", ""). */
export type RawMark = number | string | null;

export interface MarkValue {
  /** null with absent false: not marked yet */
  score: number | null;
  absent: boolean;
}

const ABSENT_WORDS = new Set(['abs', 'absent', 'a']);
const NUMBER = /^\d{1,3}(?:[.,]\d+)?$/;

/** Parses one cell. "" or null: not marked; "abs": absent; otherwise a score in 0..maxScore with up to 2 decimals. */
export function parseMark(raw: RawMark, maxScore: number): MarkValue | Problem {
  if (raw === null) return { score: null, absent: false };
  if (typeof raw === 'number') return checkScore(raw, maxScore);
  const text = raw.trim().toLowerCase();
  if (text === '') return { score: null, absent: false };
  if (ABSENT_WORDS.has(text)) return { score: null, absent: true };
  if (!NUMBER.test(text)) {
    return { code: 'MARK_INVALID', message: `"${raw.trim()}" is not a mark. Type a number such as 12.5, or ABS for absent.` };
  }
  return checkScore(Number(text.replace(',', '.')), maxScore);
}

function checkScore(score: number, maxScore: number): MarkValue | Problem {
  if (!Number.isFinite(score)) return { code: 'MARK_INVALID', message: 'A mark must be a number.' };
  if (score < 0 || score > maxScore) {
    return { code: 'MARK_OUT_OF_RANGE', message: `${score} is outside 0 to ${maxScore}.`, maxScore };
  }
  // 12.25 is fine; 12.333 is not (the small margin absorbs binary rounding such as 0.1 + 0.2).
  if (Math.abs(score * 100 - Math.round(score * 100)) > 1e-6) {
    return { code: 'MARK_PRECISION', message: `${score} has too many decimals; use at most two (e.g. 12.25).` };
  }
  return { score: Math.round(score * 100) / 100, absent: false };
}

export function isProblem(value: MarkValue | Problem): value is Problem {
  return 'code' in value;
}

/** The students of the roster with neither a score nor "absent". */
export function unmarked(rosterIds: readonly string[], marks: ReadonlyMap<string, MarkValue>): string[] {
  return rosterIds.filter((id) => {
    const m = marks.get(id);
    return !m || (m.score === null && !m.absent);
  });
}

/** Submitting needs a mark (or "absent") for every student of the section. */
export function checkComplete(rosterIds: readonly string[], marks: ReadonlyMap<string, MarkValue>): Problem | null {
  const missing = unmarked(rosterIds, marks);
  if (missing.length === 0) return null;
  return {
    code: 'MARKS_INCOMPLETE',
    message:
      missing.length === 1
        ? '1 student has no mark yet. Enter a mark or ABS before submitting.'
        : `${missing.length} students have no mark yet. Enter a mark or ABS before submitting.`,
    missing,
  };
}

/**
 * Who may change marks, by status: the teacher while open; nobody while it
 * waits for validation (the exam officer sends it back instead); once locked,
 * only an override with a reason.
 */
export function checkMarksWritable(status: AssessmentStatus, override: boolean): Problem | null {
  if (status === 'open') return null;
  if (status === 'locked') {
    return override
      ? null
      : { code: 'MARKS_LOCKED', message: 'These marks are locked. A change needs an override with a reason.' };
  }
  return {
    code: 'ASSESSMENT_NOT_OPEN',
    message: 'These marks are waiting for validation. Ask the exam officer to send the assessment back to change them.',
    status,
  };
}

export const MIN_REASON_LENGTH = 10;

/** An override of a locked mark is kept in the audit log with its reason. */
export function checkOverrideReason(reason: string | undefined): Problem | null {
  if (reason && reason.trim().length >= MIN_REASON_LENGTH) return null;
  return {
    code: 'OVERRIDE_REASON_REQUIRED',
    message: `Give the reason for changing a locked mark (at least ${MIN_REASON_LENGTH} characters).`,
  };
}

/** "12.5", "ABS" or "" — how a mark is shown back in a cell. */
export function formatMark(m: MarkValue | undefined): string {
  if (!m) return '';
  if (m.absent) return 'ABS';
  return m.score === null ? '' : String(m.score);
}

// ---------------------------------------------------------- mark sheet

export interface SheetStudent {
  studentId: string;
  matricule: string;
  fullName: string;
  gender: string;
}

export interface StoredMark {
  studentId: string;
  score: number | null;
  absent: boolean;
}

export interface SheetLine extends SheetStudent, MarkValue {
  /** false: has a mark here but is no longer in the section (transferred or withdrawn) */
  inSection: boolean;
}

export interface SheetSummary {
  students: number;
  marked: number;
  absent: number;
  missing: number;
  /** on the assessment's own scale (out of maxScore), 2 decimals */
  average: number | null;
  highest: number | null;
  lowest: number | null;
  /** scores at or above half of maxScore */
  passed: number;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * The lines of a mark sheet: every student of the section (by name), then
 * students who left but already have a mark here, so nothing disappears.
 */
export function buildSheet(
  roster: readonly SheetStudent[],
  marks: readonly StoredMark[],
  others: readonly SheetStudent[],
): SheetLine[] {
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  const inRoster = new Set(roster.map((r) => r.studentId));
  const line = (s: SheetStudent, inSection: boolean): SheetLine => {
    const m = byStudent.get(s.studentId);
    return { ...s, score: m?.score ?? null, absent: m?.absent ?? false, inSection };
  };
  const left = others
    .filter((o) => !inRoster.has(o.studentId) && byStudent.has(o.studentId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }));
  return [...roster.map((r) => line(r, true)), ...left.map((o) => line(o, false))];
}

export function summarize(lines: readonly SheetLine[], maxScore: number): SheetSummary {
  const current = lines.filter((l) => l.inSection);
  const scores = lines.filter((l) => l.score !== null).map((l) => l.score as number);
  return {
    students: current.length,
    marked: lines.filter((l) => l.score !== null).length,
    absent: lines.filter((l) => l.absent).length,
    missing: current.filter((l) => l.score === null && !l.absent).length,
    average: scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    highest: scores.length ? Math.max(...scores) : null,
    lowest: scores.length ? Math.min(...scores) : null,
    passed: scores.filter((s) => s >= maxScore / 2).length,
  };
}

export interface MarkChange {
  studentId: string;
  before: MarkValue | null;
  after: MarkValue;
}

/** What actually changes when the new values are saved over the stored ones. */
export function diffMarks(stored: readonly StoredMark[], incoming: ReadonlyMap<string, MarkValue>): MarkChange[] {
  const byStudent = new Map(stored.map((m) => [m.studentId, m]));
  const changes: MarkChange[] = [];
  for (const [studentId, after] of incoming) {
    const b = byStudent.get(studentId);
    const before = b ? { score: b.score, absent: b.absent } : null;
    const same = before
      ? before.score === after.score && before.absent === after.absent
      : after.score === null && !after.absent;
    if (!same) changes.push({ studentId, before, after });
  }
  return changes;
}
