/**
 * Pure rules of the Assessment module, kept free of Nest/Prisma so every
 * rule is unit-tested. Checks return a Problem (or null); the service picks
 * the HTTP status.
 *
 * An assessment is one test, sequence or exam of one subject in one section,
 * in one term ("Sequence 1", Mathematics, Form 1 A, First Term), marked out
 * of maxScore and counted weight times in the term average.
 *
 * Workflow:  open --submit--> submitted --validate--> validated --lock--> locked
 *            submitted / validated --reopen--> open   (sent back to the teacher)
 * Only an open assessment can be edited or deleted. Locked is final; a mark
 * changed after locking is an audited override (with the marks).
 */
import { formatDay, naturalCompare } from '../academic/academic-rules';
import type { Problem } from '../staff/staff-rules';

export type { Problem };

export type AssessmentStatus = 'open' | 'submitted' | 'validated' | 'locked';
export type AssessmentAction = 'submit' | 'validate' | 'reopen' | 'lock';

export const MAX_SCORE_LIMIT = 100;
export const MAX_WEIGHT = 10;

/** Statuses an action can start from, and where it leads. */
const TRANSITIONS: Record<AssessmentAction, { from: AssessmentStatus[]; to: AssessmentStatus }> = {
  submit: { from: ['open'], to: 'submitted' },
  validate: { from: ['submitted'], to: 'validated' },
  reopen: { from: ['submitted', 'validated'], to: 'open' },
  lock: { from: ['validated'], to: 'locked' },
};

const STATUS_WORD: Record<AssessmentStatus, string> = {
  open: 'open',
  submitted: 'submitted',
  validated: 'validated',
  locked: 'locked',
};

/** The status after the action, or the reason it is not allowed now. */
export function nextStatus(status: AssessmentStatus, action: AssessmentAction): AssessmentStatus | Problem {
  const t = TRANSITIONS[action];
  if (t.from.includes(status)) return t.to;
  const needs = t.from.map((s) => STATUS_WORD[s]).join(' or ');
  return {
    code: 'STATUS_INVALID',
    message: `This assessment is ${STATUS_WORD[status]}; only a ${needs} assessment can be ${pastTense(action)}.`,
    status,
  };
}

function pastTense(action: AssessmentAction): string {
  return { submit: 'submitted', validate: 'validated', reopen: 'reopened', lock: 'locked' }[action];
}

/** Editing (name, scores, date) and deleting are only for open assessments. */
export function checkEditable(status: AssessmentStatus): Problem | null {
  if (status === 'open') return null;
  return {
    code: 'ASSESSMENT_NOT_OPEN',
    message: `This assessment is ${STATUS_WORD[status]}. Only an open assessment can be changed or deleted.`,
    status,
  };
}

/** Out of 1 to 100 (usually 20), counted 1 to 10 times. */
export function checkScoring(maxScore: number, weight: number): Problem | null {
  if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > MAX_SCORE_LIMIT) {
    return { code: 'MAX_SCORE_INVALID', message: `An assessment is marked out of 1 to ${MAX_SCORE_LIMIT} (usually 20).` };
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
    return { code: 'WEIGHT_INVALID', message: `The weight is a whole number from 1 to ${MAX_WEIGHT}.` };
  }
  return null;
}

/** The date it was held must fall inside its term. */
export function checkHeldOn(heldOn: Date, term: { name: string; startDate: Date; endDate: Date }): Problem | null {
  if (heldOn.getTime() < term.startDate.getTime() || heldOn.getTime() > term.endDate.getTime()) {
    return {
      code: 'DATE_OUTSIDE_TERM',
      message: `${formatDay(heldOn)} is outside ${term.name} (${formatDay(term.startDate)} to ${formatDay(term.endDate)}).`,
    };
  }
  return null;
}

// -------------------------------------------------------------- views

export interface AssessmentRow {
  id: string;
  academicYearId: string;
  termId: string;
  sectionId: string;
  subjectId: string;
  name: string;
  maxScore: number;
  weight: number;
  heldOn: Date | null;
  status: string;
  submittedAt: Date | null;
  validatedAt: Date | null;
  lockedAt: Date | null;
  createdAt: Date;
}

/** Names of the things an assessment points at, looked up once per list. */
export interface Lookups {
  terms: ReadonlyMap<string, { id: string; name: string; startDate: Date }>;
  sections: ReadonlyMap<string, { id: string; label: string }>;
  subjects: ReadonlyMap<string, { id: string; code: string; name: string }>;
}

export interface AssessmentView {
  id: string;
  yearId: string;
  term: { id: string; name: string };
  section: { id: string; label: string };
  subject: { id: string; code: string; name: string };
  name: string;
  maxScore: number;
  weight: number;
  /** "2026-10-12" or null */
  heldOn: string | null;
  status: AssessmentStatus;
  submittedAt: string | null;
  validatedAt: string | null;
  lockedAt: string | null;
}

export function toAssessmentView(row: AssessmentRow, lookups: Lookups): AssessmentView {
  const term = lookups.terms.get(row.termId);
  const section = lookups.sections.get(row.sectionId);
  const subject = lookups.subjects.get(row.subjectId);
  return {
    id: row.id,
    yearId: row.academicYearId,
    term: { id: row.termId, name: term?.name ?? '?' },
    section: { id: row.sectionId, label: section?.label ?? '?' },
    subject: { id: row.subjectId, code: subject?.code ?? '?', name: subject?.name ?? '?' },
    name: row.name,
    maxScore: row.maxScore,
    weight: row.weight,
    heldOn: row.heldOn ? formatDay(row.heldOn) : null,
    status: row.status as AssessmentStatus,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
  };
}

/**
 * Lists read best by section, then subject, then term, then date held
 * (undated last), then name: "Sequence 2" after "Sequence 1".
 */
export function sortAssessments(rows: readonly AssessmentRow[], lookups: Lookups): AssessmentRow[] {
  const termStart = (r: AssessmentRow) => lookups.terms.get(r.termId)?.startDate.getTime() ?? 0;
  return [...rows].sort(
    (a, b) =>
      naturalCompare(lookups.sections.get(a.sectionId)?.label ?? '', lookups.sections.get(b.sectionId)?.label ?? '') ||
      naturalCompare(lookups.subjects.get(a.subjectId)?.name ?? '', lookups.subjects.get(b.subjectId)?.name ?? '') ||
      termStart(a) - termStart(b) ||
      (a.heldOn?.getTime() ?? Infinity) - (b.heldOn?.getTime() ?? Infinity) ||
      naturalCompare(a.name, b.name),
  );
}
