/**
 * Pure rules of the school dashboard (no Nest, no Prisma): which term to
 * report on, and how the figures are counted. The service only loads rows.
 */
import { naturalCompare } from '../academic/academic-rules';

export interface TermRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

/**
 * The term the dashboard reports on: the term running today; between two
 * terms, the last one that started; before the first term, the first one.
 * current is true only for a term running today.
 */
export function pickTerm(terms: readonly TermRow[], today: Date): { term: TermRow; current: boolean } | null {
  if (terms.length === 0) return null;
  const sorted = [...terms].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const t = today.getTime();
  const running = sorted.find((x) => x.startDate.getTime() <= t && t <= x.endDate.getTime());
  if (running) return { term: running, current: true };
  const started = sorted.filter((x) => x.startDate.getTime() <= t);
  return { term: started.length ? started[started.length - 1] : sorted[0], current: false };
}

export type AssessmentStatus = 'open' | 'submitted' | 'validated' | 'locked';

export interface StatusCounts {
  total: number;
  open: number;
  submitted: number;
  validated: number;
  locked: number;
}

export interface ClassProgress extends StatusCounts {
  classId: string;
  name: string;
}

const empty = (): StatusCounts => ({ total: 0, open: 0, submitted: 0, validated: 0, locked: 0 });

function add(counts: StatusCounts, status: string): void {
  counts.total += 1;
  if (status === 'open' || status === 'submitted' || status === 'validated' || status === 'locked') counts[status] += 1;
}

/** Assessment counts by status, overall and per class (classes in level order, only those with assessments). */
export function assessmentProgress(
  assessments: readonly { sectionId: string; status: string }[],
  classOfSection: ReadonlyMap<string, string>,
  classes: readonly { id: string; name: string; level: number }[],
): { overall: StatusCounts; byClass: ClassProgress[] } {
  const overall = empty();
  const perClass = new Map<string, StatusCounts>();
  for (const a of assessments) {
    add(overall, a.status);
    const classId = classOfSection.get(a.sectionId);
    if (!classId) continue;
    if (!perClass.has(classId)) perClass.set(classId, empty());
    add(perClass.get(classId)!, a.status);
  }
  const byClass = [...classes]
    .sort((a, b) => a.level - b.level || naturalCompare(a.name, b.name))
    .filter((c) => perClass.has(c.id))
    .map((c) => ({ classId: c.id, name: c.name, ...perClass.get(c.id)! }));
  return { overall, byClass };
}

export interface StudentFigures {
  /** active enrollments in the year */
  enrolled: number;
  girls: number;
  boys: number;
  /** active students with no class in the year */
  withoutClass: number;
}

export function studentFigures(
  activeStudents: readonly { id: string; gender: string }[],
  enrolledIds: ReadonlySet<string>,
): StudentFigures {
  const enrolled = activeStudents.filter((s) => enrolledIds.has(s.id));
  return {
    enrolled: enrolled.length,
    girls: enrolled.filter((s) => s.gender === 'female').length,
    boys: enrolled.filter((s) => s.gender === 'male').length,
    withoutClass: activeStudents.length - enrolled.length,
  };
}
