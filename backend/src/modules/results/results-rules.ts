/**
 * Pure rules for term results (averages, ranks, class statistics). No Nest
 * or Prisma here, so every rule is unit-tested; the Results module feeds
 * them from the database, and the report card (Track A) reads their output.
 *
 * How a term is computed, for one section:
 *  1. Every mark is brought to /20:  score / maxScore * 20.
 *  2. Subject average = weighted mean of those over the subject's
 *     assessments in the term (weight = the assessment's weight).
 *     An absence does not count, in either direction; a student with no
 *     score at all in a subject has no average in it ("not classified").
 *  3. General average = sum(subject average x coefficient) / sum(coefficients),
 *     over the subjects where the student has an average.
 *  4. Ranks: highest average first; equal averages (to 2 decimals) share a
 *     rank and the next rank is skipped (1, 2, 2, 4). No average, no rank.
 *  5. The pass mark is 10/20.
 * Averages are rounded to 2 decimals only when they leave these rules.
 */

export const SCALE = 20;
export const PASS_MARK = 10;

/** Rounds to 2 decimals (12.345 -> 12.35), away from binary noise. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The usual appreciation for an average out of 20. */
export function appreciation(average: number | null): string | null {
  if (average === null) return null;
  if (average >= 18) return 'Excellent';
  if (average >= 16) return 'Very good';
  if (average >= 14) return 'Good';
  if (average >= 12) return 'Fairly good';
  if (average >= 10) return 'Average';
  if (average >= 8) return 'Weak';
  return 'Poor';
}

// ------------------------------------------------------------ input

export interface ResultSubject {
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
  /** the teacher shown on the report card, if assigned */
  teacher?: string | null;
}

export interface ResultAssessment {
  id: string;
  subjectId: string;
  name: string;
  maxScore: number;
  weight: number;
}

export interface ResultMark {
  assessmentId: string;
  studentId: string;
  score: number | null;
  absent: boolean;
}

export interface ResultStudent {
  studentId: string;
  matricule: string;
  fullName: string;
}

export interface TermInput {
  subjects: readonly ResultSubject[];
  /** the assessments that count (normally the locked ones of the term) */
  assessments: readonly ResultAssessment[];
  marks: readonly ResultMark[];
  students: readonly ResultStudent[];
}

// ----------------------------------------------------------- output

export interface SubjectLine {
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
  teacher: string | null;
  /** /20, 2 decimals; null = no score in this subject */
  average: number | null;
  /** average x coefficient, 2 decimals */
  points: number | null;
  /** rank in the section for this subject */
  rank: number | null;
  appreciation: string | null;
}

export interface StudentResult {
  student: ResultStudent;
  subjects: SubjectLine[];
  /** coefficients of the subjects with an average */
  totalCoefficient: number;
  totalPoints: number;
  /** /20, 2 decimals; null = no average in any subject */
  average: number | null;
  rank: number | null;
  passed: boolean;
  appreciation: string | null;
}

export interface SubjectStats {
  subjectId: string;
  code: string;
  name: string;
  classAverage: number | null;
  highest: number | null;
  lowest: number | null;
}

export interface ClassStats {
  /** students in the section */
  size: number;
  /** students with a general average */
  classified: number;
  classAverage: number | null;
  highest: number | null;
  lowest: number | null;
  passed: number;
  /** percentage of classified students at or above the pass mark, 1 decimal */
  passRate: number | null;
}

export interface TermResults {
  /** by rank, then name; unclassified last */
  students: StudentResult[];
  subjects: SubjectStats[];
  stats: ClassStats;
}

// --------------------------------------------------------- the rules

/** Weighted mean on /20 of one student's scores in one subject; null if none. */
export function subjectAverage(
  assessments: readonly ResultAssessment[],
  scoreOf: (assessmentId: string) => ResultMark | undefined,
): number | null {
  let sum = 0;
  let weights = 0;
  for (const a of assessments) {
    const mark = scoreOf(a.id);
    if (!mark || mark.absent || mark.score === null) continue;
    sum += (mark.score / a.maxScore) * SCALE * a.weight;
    weights += a.weight;
  }
  return weights === 0 ? null : sum / weights;
}

/** sum(average x coefficient) / sum(coefficients), over the subjects that have an average. */
export function generalAverage(lines: readonly { average: number | null; coefficient: number }[]): {
  average: number | null;
  totalCoefficient: number;
  totalPoints: number;
} {
  let points = 0;
  let coefficients = 0;
  for (const l of lines) {
    if (l.average === null) continue;
    points += l.average * l.coefficient;
    coefficients += l.coefficient;
  }
  return { average: coefficients === 0 ? null : points / coefficients, totalCoefficient: coefficients, totalPoints: points };
}

/** Competition ranks (1, 2, 2, 4) by value, highest first, compared to 2 decimals; null values get null. */
export function rank<T>(items: readonly T[], valueOf: (item: T) => number | null): Map<T, number | null> {
  const ranked = items
    .map((item) => ({ item, value: valueOf(item) }))
    .filter((x): x is { item: T; value: number } => x.value !== null)
    .sort((a, b) => b.value - a.value);
  const out = new Map<T, number | null>(items.map((i) => [i, null]));
  let previous: number | null = null;
  let previousRank = 0;
  ranked.forEach((x, index) => {
    const value = round2(x.value);
    const r = previous !== null && value === previous ? previousRank : index + 1;
    out.set(x.item, r);
    previous = value;
    previousRank = r;
  });
  return out;
}

function stats(values: readonly number[]): { mean: number | null; highest: number | null; lowest: number | null } {
  if (values.length === 0) return { mean: null, highest: null, lowest: null };
  return {
    mean: round2(values.reduce((a, b) => a + b, 0) / values.length),
    highest: round2(Math.max(...values)),
    lowest: round2(Math.min(...values)),
  };
}

const r2 = (v: number | null) => (v === null ? null : round2(v));

/** Results of one section for one term. */
export function computeTerm(input: TermInput): TermResults {
  const markOf = new Map(input.marks.map((m) => [`${m.assessmentId}|${m.studentId}`, m]));
  const bySubject = new Map<string, ResultAssessment[]>();
  for (const a of input.assessments) bySubject.set(a.subjectId, [...(bySubject.get(a.subjectId) ?? []), a]);

  // Raw (unrounded) subject averages per student.
  const raw = input.students.map((student) => ({
    student,
    lines: input.subjects.map((subject) => ({
      subject,
      average: subjectAverage(bySubject.get(subject.subjectId) ?? [], (id) => markOf.get(`${id}|${student.studentId}`)),
    })),
  }));

  // Subject ranks.
  const subjectRanks = new Map<string, Map<string, number | null>>();
  for (const subject of input.subjects) {
    const ranks = rank(raw, (r) => r.lines.find((l) => l.subject.subjectId === subject.subjectId)!.average);
    subjectRanks.set(subject.subjectId, new Map([...ranks].map(([r, n]) => [r.student.studentId, n])));
  }

  const results = raw.map((r) => {
    const general = generalAverage(r.lines.map((l) => ({ average: l.average, coefficient: l.subject.coefficient })));
    return { r, general };
  });
  const generalRanks = rank(results, (x) => x.general.average);

  const students: StudentResult[] = results.map((entry) => {
    const { r, general } = entry;
    const average = r2(general.average);
    return {
      student: r.student,
      subjects: r.lines.map((l) => ({
        subjectId: l.subject.subjectId,
        code: l.subject.code,
        name: l.subject.name,
        coefficient: l.subject.coefficient,
        teacher: l.subject.teacher ?? null,
        average: r2(l.average),
        points: l.average === null ? null : round2(l.average * l.subject.coefficient),
        rank: subjectRanks.get(l.subject.subjectId)!.get(r.student.studentId) ?? null,
        appreciation: appreciation(r2(l.average)),
      })),
      totalCoefficient: general.totalCoefficient,
      totalPoints: round2(general.totalPoints),
      average,
      rank: generalRanks.get(entry) ?? null,
      passed: average !== null && average >= PASS_MARK,
      appreciation: appreciation(average),
    };
  });

  students.sort(
    (a, b) =>
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      a.student.fullName.localeCompare(b.student.fullName, undefined, { sensitivity: 'base' }),
  );

  const averages = students.map((s) => s.average).filter((a): a is number => a !== null);
  const all = stats(averages);
  const passed = students.filter((s) => s.passed).length;

  return {
    students,
    subjects: input.subjects.map((subject) => {
      const values = raw
        .map((r) => r.lines.find((l) => l.subject.subjectId === subject.subjectId)!.average)
        .filter((a): a is number => a !== null);
      const s = stats(values);
      return {
        subjectId: subject.subjectId,
        code: subject.code,
        name: subject.name,
        classAverage: s.mean,
        highest: s.highest,
        lowest: s.lowest,
      };
    }),
    stats: {
      size: input.students.length,
      classified: averages.length,
      classAverage: all.mean,
      highest: all.highest,
      lowest: all.lowest,
      passed,
      passRate: averages.length === 0 ? null : Math.round((passed / averages.length) * 1000) / 10,
    },
  };
}

/** The year's average: the mean of the term averages the student has (null if none). */
export function annualAverage(termAverages: readonly (number | null)[]): number | null {
  const values = termAverages.filter((a): a is number => a !== null);
  return values.length === 0 ? null : round2(values.reduce((a, b) => a + b, 0) / values.length);
}

// ------------------------------------------------------ report cards

/**
 * Everything one report card shows (Track A prints it). One per student of
 * the section, in rank order. This is the shape GET /api/results/... will
 * return, so the report card page can be built against the sample file.
 */
export interface ReportCardData {
  school: { name: string };
  /** true: the official, published results; false: provisional (not published yet, print as a draft) */
  published: boolean;
  /** ISO date-time of the publication, when published */
  publishedAt: string | null;
  year: { id: string; name: string };
  term: { id: string; name: string };
  section: { id: string; label: string };
  result: StudentResult;
  /** the section as a whole, for "class average", "highest", "rank x of y" */
  stats: ClassStats;
  subjectStats: SubjectStats[];
}

export function toReportCards(
  header: Pick<ReportCardData, 'school' | 'year' | 'term' | 'section' | 'published' | 'publishedAt'>,
  results: TermResults,
): ReportCardData[] {
  return results.students.map((result) => ({ ...header, result, stats: results.stats, subjectStats: results.subjects }));
}

// -------------------------------------------------------- publication

/**
 * Results of a section are published once per term (republishing replaces
 * them). They can be published only when final: every assessment of the
 * term in the section is locked, and at least one student has an average.
 */
export function checkPublishable(input: {
  label: string;
  termName: string;
  counted: number;
  pending: number;
  classified: number;
}): { code: string; message: string } | null {
  if (input.pending > 0) {
    return {
      code: 'RESULTS_NOT_FINAL',
      message: `${input.pending} assessment${input.pending === 1 ? '' : 's'} of ${input.termName} in ${input.label} ${
        input.pending === 1 ? 'is' : 'are'
      } not locked yet. Lock or delete ${input.pending === 1 ? 'it' : 'them'} before publishing.`,
    };
  }
  if (input.counted === 0 || input.classified === 0) {
    return {
      code: 'NOTHING_TO_PUBLISH',
      message: `There are no locked marks for ${input.label} in ${input.termName} yet.`,
    };
  }
  return null;
}

/** A student whose published result differs from the live one (a mark was overridden after publishing). */
export interface ResultChange {
  studentId: string;
  fullName: string;
  before: { average: number | null; rank: number | null } | null;
  after: { average: number | null; rank: number | null } | null;
}

/** What would change if the section were republished now; empty when the published results are up to date. */
export function changesSincePublication(published: TermResults, live: TermResults): ResultChange[] {
  const before = new Map(published.students.map((s) => [s.student.studentId, s]));
  const after = new Map(live.students.map((s) => [s.student.studentId, s]));
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const changes: ResultChange[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    const same = b && a && b.average === a.average && b.rank === a.rank;
    if (same) continue;
    changes.push({
      studentId: id,
      fullName: (a ?? b)!.student.fullName,
      before: b ? { average: b.average, rank: b.rank } : null,
      after: a ? { average: a.average, rank: a.rank } : null,
    });
  }
  return changes.sort((x, y) => x.fullName.localeCompare(y.fullName, undefined, { sensitivity: 'base' }));
}

// ------------------------------------------------------------ the year

/** One term of the year as counted for annual results. */
export interface TermOfYear {
  termId: string;
  name: string;
  /** true: the published copy was used; false: computed now from locked assessments */
  published: boolean;
  results: TermResults;
}

export type Decision = 'promoted' | 'repeat';

export interface AnnualLine {
  student: ResultStudent;
  /** the student's general average and rank in each term, in term order */
  terms: { termId: string; average: number | null; rank: number | null }[];
  /** mean of the term averages the student has; null when none */
  average: number | null;
  rank: number | null;
  /** promoted at PASS_MARK or more, repeat below; null when not classified */
  decision: Decision | null;
  appreciation: string | null;
}

export interface AnnualResults {
  terms: { termId: string; name: string; published: boolean }[];
  /** by rank, then name; unclassified last */
  students: AnnualLine[];
  stats: { size: number; classified: number; classAverage: number | null; promoted: number; repeat: number };
}

/**
 * Annual results of a section: the mean of each student's term averages
 * (terms without an average are left out, as for subjects), ranked, with
 * the promotion decision at the pass mark. Students are those of the
 * latest term given (the current class list).
 */
export function computeAnnual(terms: readonly TermOfYear[]): AnnualResults {
  const last = terms[terms.length - 1];
  const students = last ? last.results.students.map((s) => s.student) : [];
  const termLookup = terms.map((t) => new Map(t.results.students.map((s) => [s.student.studentId, s])));

  const lines = students.map((student) => {
    const perTerm = terms.map((t, i) => {
      const r = termLookup[i].get(student.studentId);
      return { termId: t.termId, average: r?.average ?? null, rank: r?.rank ?? null };
    });
    return { student, terms: perTerm, raw: annualAverage(perTerm.map((p) => p.average)) };
  });
  const ranks = rank(lines, (l) => l.raw);
  const out: AnnualLine[] = lines.map((l) => ({
    student: l.student,
    terms: l.terms,
    average: l.raw,
    rank: ranks.get(l) ?? null,
    decision: l.raw === null ? null : l.raw >= PASS_MARK ? 'promoted' : 'repeat',
    appreciation: appreciation(l.raw),
  }));
  out.sort(
    (a, b) =>
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      a.student.fullName.localeCompare(b.student.fullName, undefined, { sensitivity: 'base' }),
  );
  const averages = out.map((l) => l.average).filter((a): a is number => a !== null);
  return {
    terms: terms.map((t) => ({ termId: t.termId, name: t.name, published: t.published })),
    students: out,
    stats: {
      size: out.length,
      classified: averages.length,
      classAverage: averages.length ? round2(averages.reduce((a, b) => a + b, 0) / averages.length) : null,
      promoted: out.filter((l) => l.decision === 'promoted').length,
      repeat: out.filter((l) => l.decision === 'repeat').length,
    },
  };
}

// ------------------------------------------------- term summary (basic reporting)

/** published: frozen copy; final: every assessment locked; in_progress: some marks still open. */
export type SummaryState = 'published' | 'final' | 'in_progress';

export interface SummaryClassInput {
  sectionId: string;
  label: string;
  state: SummaryState;
  results: TermResults;
}

export interface SummaryClass {
  sectionId: string;
  label: string;
  state: SummaryState;
  size: number;
  classified: number;
  classAverage: number | null;
  passed: number;
  passRate: number | null;
}

export interface SummarySubject {
  subjectId: string;
  code: string;
  name: string;
  /** students with an average in this subject, all classes together */
  graded: number;
  /** of them, at or above the pass mark */
  passed: number;
  passRate: number | null;
  /** mean of the students' subject averages, 2 decimals */
  average: number | null;
  /** class average of the subject, by sectionId (absent: the class does not take it) */
  byClass: Record<string, number | null>;
}

export interface TermSummary {
  classes: SummaryClass[];
  subjects: SummarySubject[];
  totals: { size: number; classified: number; passed: number; passRate: number | null; average: number | null };
}

/** Percentage with 1 decimal; null when there is nobody to count. */
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

const mean2 = (values: readonly number[]): number | null =>
  values.length === 0 ? null : round2(values.reduce((a, b) => a + b, 0) / values.length);

/**
 * The school's figures for one term: one line per class, one line per subject
 * over every class, and the school totals. Works the same on live results and
 * on published copies (it only reads the students' lines).
 */
export function termSummary(classes: readonly SummaryClassInput[]): TermSummary {
  const subjects = new Map<string, { code: string; name: string; values: number[]; byClass: Record<string, number | null> }>();
  const allAverages: number[] = [];
  let size = 0;
  let passed = 0;

  const lines: SummaryClass[] = classes.map((c) => {
    const s = c.results.stats;
    size += s.size;
    passed += s.passed;
    for (const st of c.results.students) if (st.average !== null) allAverages.push(st.average);
    for (const subject of c.results.subjects) {
      const entry = subjects.get(subject.subjectId) ?? { code: subject.code, name: subject.name, values: [], byClass: {} };
      entry.byClass[c.sectionId] = subject.classAverage;
      subjects.set(subject.subjectId, entry);
    }
    for (const st of c.results.students) {
      for (const line of st.subjects) {
        if (line.average !== null) subjects.get(line.subjectId)?.values.push(line.average);
      }
    }
    return {
      sectionId: c.sectionId,
      label: c.label,
      state: c.state,
      size: s.size,
      classified: s.classified,
      classAverage: s.classAverage,
      passed: s.passed,
      passRate: s.passRate,
    };
  });

  return {
    classes: lines,
    subjects: [...subjects.entries()].map(([subjectId, e]) => {
      const ok = e.values.filter((v) => v >= PASS_MARK).length;
      return {
        subjectId,
        code: e.code,
        name: e.name,
        graded: e.values.length,
        passed: ok,
        passRate: percent(ok, e.values.length),
        average: mean2(e.values),
        byClass: e.byClass,
      };
    }),
    totals: {
      size,
      classified: allAverages.length,
      passed,
      passRate: percent(passed, allAverages.length),
      average: mean2(allAverages),
    },
  };
}

// ---------------------------------------------- one student's year (student page)

export interface StudentTerm {
  termId: string;
  name: string;
  published: boolean;
  /** the student's subject lines, average, rank and appreciation; null when not on the class list that term */
  result: StudentResult | null;
  /** students with an average in the class that term (the "out of" of the rank) */
  classified: number;
  classAverage: number | null;
}

export interface StudentYear {
  terms: StudentTerm[];
  /** the year average, rank and decision in the class; null when the student is not on its list */
  annual: AnnualLine | null;
  classified: number;
}

/** One student's results over the year, taken from the class results of each term. */
export function studentYear(terms: readonly TermOfYear[], studentId: string): StudentYear {
  const year = computeAnnual(terms);
  return {
    terms: terms.map((t) => ({
      termId: t.termId,
      name: t.name,
      published: t.published,
      result: t.results.students.find((s) => s.student.studentId === studentId) ?? null,
      classified: t.results.stats.classified,
      classAverage: t.results.stats.classAverage,
    })),
    annual: year.students.find((l) => l.student.studentId === studentId) ?? null,
    classified: year.stats.classified,
  };
}
