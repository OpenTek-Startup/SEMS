import {
  annualAverage,
  appreciation,
  computeTerm,
  generalAverage,
  rank,
  round2,
  subjectAverage,
  toReportCards,
  checkPublishable,
  changesSincePublication,
  computeAnnual,
  percent,
  studentYear,
  termSummary,
  type ResultAssessment,
  type ResultMark,
  type TermInput,
} from './results-rules';

const MATH = { subjectId: 'math', code: 'MATH', name: 'Mathematics', coefficient: 4, teacher: 'Ngwa Brenda' };
const ENG = { subjectId: 'eng', code: 'ENG', name: 'English Language', coefficient: 3 };
const CIV = { subjectId: 'civ', code: 'CIV', name: 'Citizenship Education', coefficient: 1 };

const assessments: ResultAssessment[] = [
  { id: 'm1', subjectId: 'math', name: 'Sequence 1', maxScore: 20, weight: 1 },
  { id: 'm2', subjectId: 'math', name: 'Sequence 2', maxScore: 40, weight: 2 },
  { id: 'e1', subjectId: 'eng', name: 'Sequence 1', maxScore: 20, weight: 1 },
  { id: 'c1', subjectId: 'civ', name: 'Sequence 1', maxScore: 20, weight: 1 },
];

const mark = (assessmentId: string, studentId: string, score: number | null, absent = false): ResultMark => ({
  assessmentId,
  studentId,
  score,
  absent,
});

const students = [
  { studentId: 'ada', matricule: 'NF-001', fullName: 'Abena Ada' },
  { studentId: 'bih', matricule: 'NF-002', fullName: 'Bih Clarisse' },
  { studentId: 'che', matricule: 'NF-003', fullName: 'Che Daniel' },
  { studentId: 'eto', matricule: 'NF-004', fullName: 'Eto Samuel' },
  { studentId: 'new', matricule: 'NF-005', fullName: 'Fai New' },
];

const input: TermInput = {
  subjects: [MATH, ENG, CIV],
  assessments,
  students,
  marks: [
    // Ada: MATH (16/20 x1 + 30/40 x2) -> (16 + 15*2)/3 = 15.33; ENG 12; CIV 18
    //      general (15.33*4 + 12*3 + 18*1) / 8 = 14.42
    mark('m1', 'ada', 16),
    mark('m2', 'ada', 30),
    mark('e1', 'ada', 12),
    mark('c1', 'ada', 18),
    // Bih: absent in Sequence 1 of MATH -> MATH = 36/40 -> 18; ENG 9; CIV 10 -> 109 / 8 = 13.63
    mark('m1', 'bih', null, true),
    mark('m2', 'bih', 36),
    mark('e1', 'bih', 9),
    mark('c1', 'bih', 10),
    // Che: same marks as Ada -> same rank
    mark('m1', 'che', 16),
    mark('m2', 'che', 30),
    mark('e1', 'che', 12),
    mark('c1', 'che', 18),
    // Eto: MATH 6, ENG 8, absent in CIV -> CIV not counted: 48 / 7 = 6.86
    mark('m1', 'eto', 6),
    mark('m2', 'eto', 12),
    mark('e1', 'eto', 8),
    mark('c1', 'eto', null, true),
    // Fai joined late: no marks at all
  ],
};

describe('results rules', () => {
  it('rounds to 2 decimals and gives the appreciation', () => {
    expect(round2(12.345)).toBe(12.35);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(15.333333)).toBe(15.33);
    expect(appreciation(18)).toBe('Excellent');
    expect(appreciation(16.5)).toBe('Very good');
    expect(appreciation(14)).toBe('Good');
    expect(appreciation(12)).toBe('Fairly good');
    expect(appreciation(10)).toBe('Average');
    expect(appreciation(9.99)).toBe('Weak');
    expect(appreciation(7.5)).toBe('Poor');
    expect(appreciation(null)).toBeNull();
  });

  it('subject average: on /20, weighted, absences left out', () => {
    const math = assessments.filter((a) => a.subjectId === 'math');
    const of = (marks: ResultMark[]) => (id: string) => marks.find((m) => m.assessmentId === id);
    expect(subjectAverage(math, of([mark('m1', 'x', 16), mark('m2', 'x', 30)]))).toBeCloseTo(15.333, 3);
    expect(subjectAverage(math, of([mark('m1', 'x', null, true), mark('m2', 'x', 36)]))).toBe(18);
    expect(subjectAverage(math, of([mark('m1', 'x', 10)]))).toBe(10);
    expect(subjectAverage(math, of([mark('m1', 'x', null, true)]))).toBeNull();
    expect(subjectAverage(math, of([]))).toBeNull();
    expect(subjectAverage([], of([]))).toBeNull();
  });

  it('general average: coefficients, over the subjects with an average', () => {
    expect(
      generalAverage([
        { average: 15, coefficient: 4 },
        { average: 12, coefficient: 3 },
        { average: null, coefficient: 1 },
      ]),
    ).toEqual({ average: 96 / 7, totalCoefficient: 7, totalPoints: 96 });
    expect(generalAverage([{ average: null, coefficient: 4 }])).toEqual({ average: null, totalCoefficient: 0, totalPoints: 0 });
  });

  it('ranks highest first, ties share a rank, the next is skipped', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const values: Record<string, number | null> = { a: 12.001, b: 15, c: 12.004, d: null, e: 9 };
    const ranks = rank(items, (i) => values[i]);
    expect(items.map((i) => ranks.get(i))).toEqual([2, 1, 2, null, 4]);
  });

  it('computes a whole section: averages, ranks, appreciations, statistics', () => {
    const result = computeTerm(input);
    expect(result.students.map((s) => [s.student.fullName, s.average, s.rank])).toEqual([
      ['Abena Ada', 14.42, 1],
      ['Che Daniel', 14.42, 1],
      ['Bih Clarisse', 13.63, 3],
      ['Eto Samuel', 6.86, 4],
      ['Fai New', null, null],
    ]);

    const ada = result.students[0];
    expect(ada.subjects).toEqual([
      { subjectId: 'math', code: 'MATH', name: 'Mathematics', coefficient: 4, teacher: 'Ngwa Brenda', average: 15.33, points: 61.33, rank: 2, appreciation: 'Good' },
      { subjectId: 'eng', code: 'ENG', name: 'English Language', coefficient: 3, teacher: null, average: 12, points: 36, rank: 1, appreciation: 'Fairly good' },
      { subjectId: 'civ', code: 'CIV', name: 'Citizenship Education', coefficient: 1, teacher: null, average: 18, points: 18, rank: 1, appreciation: 'Excellent' },
    ]);
    expect(ada).toMatchObject({ totalCoefficient: 8, totalPoints: 115.33, passed: true, appreciation: 'Good' });

    // Bih: MATH 18 (absence left out) -> first in Mathematics.
    const bih = result.students.find((s) => s.student.studentId === 'bih')!;
    expect(bih.subjects[0]).toMatchObject({ average: 18, rank: 1 });
    // Eto: absent in CIV -> CIV not counted in his coefficients.
    const eto = result.students.find((s) => s.student.studentId === 'eto')!;
    expect(eto.subjects[2]).toMatchObject({ average: null, points: null, rank: null, appreciation: null });
    expect(eto).toMatchObject({ totalCoefficient: 7, passed: false, appreciation: 'Poor' });
    const fai = result.students[4];
    expect(fai).toMatchObject({ average: null, rank: null, passed: false, totalCoefficient: 0 });

    expect(result.stats).toEqual({
      size: 5,
      classified: 4,
      classAverage: 12.33,
      highest: 14.42,
      lowest: 6.86,
      passed: 3,
      passRate: 75,
    });
    expect(result.subjects[0]).toEqual({ subjectId: 'math', code: 'MATH', name: 'Mathematics', classAverage: 13.67, highest: 18, lowest: 6 });
    expect(result.subjects[2]).toMatchObject({ code: 'CIV', classAverage: 15.33, highest: 18, lowest: 10 });
  });

  it('an empty section or a term with no assessment gives empty results', () => {
    expect(computeTerm({ subjects: [MATH], assessments: [], marks: [], students: [] }).stats).toEqual({
      size: 0,
      classified: 0,
      classAverage: null,
      highest: null,
      lowest: null,
      passed: 0,
      passRate: null,
    });
    const noMarks = computeTerm({ subjects: [MATH], assessments: [], marks: [], students: students.slice(0, 1) });
    expect(noMarks.students[0]).toMatchObject({ average: null, rank: null });
  });

  it('annual average: mean of the terms the student has', () => {
    expect(annualAverage([12, 14, 13])).toBe(13);
    expect(annualAverage([12.5, null, 13.25])).toBe(12.88);
    expect(annualAverage([null, null])).toBeNull();
  });
});

describe('report cards', () => {
  it('gives one card per student, in rank order, with the section statistics', () => {
    const header = {
      school: { name: 'Northfield Bilingual College' },
      published: true,
      publishedAt: '2026-12-15T10:00:00.000Z',
      year: { id: 'y1', name: '2026-2027' },
      term: { id: 't1', name: 'First Term' },
      section: { id: 's1', label: 'Form 1 A' },
    };
    const cards = toReportCards(header, computeTerm(input));
    expect(cards).toHaveLength(5);
    expect(cards[0]).toMatchObject({ ...header, result: { student: { fullName: 'Abena Ada' }, rank: 1 }, stats: { size: 5 } });
    expect(cards[4].result.rank).toBeNull();
    expect(cards[0].subjectStats).toHaveLength(3);
  });
});

describe('publication rules', () => {
  const base = { label: 'Form 1 A', termName: 'First Term' };

  it('publishes only final results', () => {
    expect(checkPublishable({ ...base, counted: 4, pending: 0, classified: 30 })).toBeNull();
    expect(checkPublishable({ ...base, counted: 4, pending: 1, classified: 30 })).toEqual({
      code: 'RESULTS_NOT_FINAL',
      message: '1 assessment of First Term in Form 1 A is not locked yet. Lock or delete it before publishing.',
    });
    expect(checkPublishable({ ...base, counted: 4, pending: 3, classified: 30 })?.message).toBe(
      '3 assessments of First Term in Form 1 A are not locked yet. Lock or delete them before publishing.',
    );
    expect(checkPublishable({ ...base, counted: 0, pending: 0, classified: 0 })?.code).toBe('NOTHING_TO_PUBLISH');
    expect(checkPublishable({ ...base, counted: 2, pending: 0, classified: 0 })?.code).toBe('NOTHING_TO_PUBLISH');
  });

  it('lists the students whose average or rank changed since publishing', () => {
    const published = computeTerm(input);
    expect(changesSincePublication(published, computeTerm(input))).toEqual([]);

    // Bih's Sequence 1 absence is overridden to 4/20 after publishing.
    const live = computeTerm({
      ...input,
      marks: input.marks.map((m) => (m.assessmentId === 'm1' && m.studentId === 'bih' ? { ...m, score: 4, absent: false } : m)),
    });
    const changes = changesSincePublication(published, live);
    // She stays third: only her own line changes.
    expect(changes.map((c) => c.fullName)).toEqual(['Bih Clarisse']);
    expect(changes.find((c) => c.studentId === 'bih')).toEqual({
      studentId: 'bih',
      fullName: 'Bih Clarisse',
      before: { average: 13.63, rank: 3 },
      after: { average: 11.29, rank: 3 },
    });
  });
});

describe('annual results', () => {
  // Three terms built from the same section: term averages are those of computeTerm.
  const term = (termId: string, name: string, override: (m: ResultMark) => ResultMark = (m) => m) => ({
    termId,
    name,
    published: termId === 't1',
    results: computeTerm({ ...input, marks: input.marks.map(override) }),
  });

  it('averages the term averages, ranks, and decides promotion at 10', () => {
    // Term 1 as in the section above (Ada 14.42, Che 14.42, Bih 13.63, Eto 6.86, Fai none);
    // term 2: Eto does much better in MATH; term 3: nobody has marks except in MATH sequence 1.
    const t1 = term('t1', 'First Term');
    const t2 = term('t2', 'Second Term', (m) => (m.studentId === 'eto' && m.assessmentId.startsWith('m') ? { ...m, score: m.assessmentId === 'm1' ? 18 : 36 } : m));
    const year = computeAnnual([t1, t2]);
    expect(year.terms).toEqual([
      { termId: 't1', name: 'First Term', published: true },
      { termId: 't2', name: 'Second Term', published: false },
    ]);
    const eto = year.students.find((l) => l.student.studentId === 'eto')!;
    expect(eto.terms.map((t) => t.average)).toEqual([6.86, 13.71]);
    expect(eto).toMatchObject({ average: 10.29, decision: 'promoted', appreciation: 'Average' });
    expect(year.students.map((l) => [l.student.fullName, l.average, l.rank])).toEqual([
      ['Abena Ada', 14.42, 1],
      ['Che Daniel', 14.42, 1],
      ['Bih Clarisse', 13.63, 3],
      ['Eto Samuel', 10.29, 4],
      ['Fai New', null, null],
    ]);
    expect(year.students[4]).toMatchObject({ decision: null, appreciation: null });
    expect(year.stats).toEqual({ size: 5, classified: 4, classAverage: 13.19, promoted: 4, repeat: 0 });
  });

  it('a student below 10 over the year repeats; a term without an average is left out', () => {
    const t1 = term('t1', 'First Term');
    const t2 = term('t2', 'Second Term', (m) => (m.studentId === 'eto' ? { ...m, score: null, absent: true } : m));
    const year = computeAnnual([t1, t2]);
    const eto = year.students.find((l) => l.student.studentId === 'eto')!;
    expect(eto.terms.map((t) => t.average)).toEqual([6.86, null]);
    expect(eto).toMatchObject({ average: 6.86, decision: 'repeat', appreciation: 'Poor' });
    expect(year.stats).toMatchObject({ promoted: 3, repeat: 1 });
    expect(computeAnnual([])).toEqual({ terms: [], students: [], stats: { size: 0, classified: 0, classAverage: null, promoted: 0, repeat: 0 } });
  });
});

describe('term summary', () => {
  // Form 1 A: the section above. Form 1 B: two students, Mathematics only.
  const a = computeTerm(input);
  const b = computeTerm({
    subjects: [MATH],
    assessments: assessments.filter((x) => x.subjectId === 'math'),
    students: [
      { studentId: 'gab', matricule: 'NF-006', fullName: 'Gaba Ruth' },
      { studentId: 'hil', matricule: 'NF-007', fullName: 'Hilary Ivan' },
    ],
    marks: [mark('m1', 'gab', 20), mark('m2', 'gab', 40), mark('m1', 'hil', 8), mark('m2', 'hil', 16)],
  });

  it('gives one line per class, per subject over every class, and the school totals', () => {
    const summary = termSummary([
      { sectionId: 'f1a', label: 'Form 1 A', state: 'published', results: a },
      { sectionId: 'f1b', label: 'Form 1 B', state: 'in_progress', results: b },
    ]);
    expect(summary.classes).toEqual([
      { sectionId: 'f1a', label: 'Form 1 A', state: 'published', size: 5, classified: 4, classAverage: 12.33, passed: 3, passRate: 75 },
      { sectionId: 'f1b', label: 'Form 1 B', state: 'in_progress', size: 2, classified: 2, classAverage: 14, passed: 1, passRate: 50 },
    ]);
    // MATH: 15.33, 18, 15.33, 6 in Form 1 A; 20 and 8 in Form 1 B.
    expect(summary.subjects[0]).toEqual({
      subjectId: 'math',
      code: 'MATH',
      name: 'Mathematics',
      graded: 6,
      passed: 4,
      passRate: 66.7,
      average: 13.78,
      byClass: { f1a: 13.67, f1b: 14 },
    });
    // ENG and CIV are taken in Form 1 A only; Eto was absent in CIV.
    expect(summary.subjects.slice(1).map((s) => [s.code, s.graded, s.passed, s.passRate, s.average, Object.keys(s.byClass)])).toEqual([
      ['ENG', 4, 2, 50, 10.25, ['f1a']],
      ['CIV', 3, 3, 100, 15.33, ['f1a']],
    ]);
    // 14.42, 14.42, 13.63, 6.86, 20, 8 -> 12.89; 4 of 6 at 10 or above.
    expect(summary.totals).toEqual({ size: 7, classified: 6, passed: 4, passRate: 66.7, average: 12.89 });
  });

  it('an empty school gives empty figures', () => {
    expect(termSummary([])).toEqual({
      classes: [],
      subjects: [],
      totals: { size: 0, classified: 0, passed: 0, passRate: null, average: null },
    });
    expect(percent(1, 3)).toBe(33.3);
  });
});

describe("one student's year", () => {
  const t1 = { termId: 't1', name: 'First Term', published: true, results: computeTerm(input) };
  const t2 = {
    termId: 't2',
    name: 'Second Term',
    published: false,
    results: computeTerm({ ...input, marks: input.marks.map((m) => (m.studentId === 'eto' && m.assessmentId.startsWith('m') ? { ...m, score: m.assessmentId === 'm1' ? 18 : 36 } : m)) }),
  };

  it('gives each term of the student, then the year average, rank and decision', () => {
    const eto = studentYear([t1, t2], 'eto');
    expect(eto.terms.map((t) => [t.name, t.published, t.result?.average, t.result?.rank, t.classified, t.classAverage])).toEqual([
      ['First Term', true, 6.86, 4, 4, 12.33],
      ['Second Term', false, 13.71, 3, 4, 14.05],
    ]);
    expect(eto.terms[0].result?.subjects.map((l) => [l.code, l.average])).toEqual([
      ['MATH', 6],
      ['ENG', 8],
      ['CIV', null],
    ]);
    expect(eto.annual).toMatchObject({ average: 10.29, rank: 4, decision: 'promoted' });
    expect(eto.classified).toBe(4);
  });

  it('a student who is not on the class list gets no result', () => {
    const nobody = studentYear([t1], 'nobody');
    expect(nobody.terms[0].result).toBeNull();
    expect(nobody.annual).toBeNull();
    expect(studentYear([], 'eto')).toEqual({ terms: [], annual: null, classified: 0 });
  });
});
