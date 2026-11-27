import { assessmentProgress, pickTerm, studentFigures } from './dashboard-rules';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const TERMS = [
  { id: 't2', name: 'Second Term', startDate: day('2027-01-04'), endDate: day('2027-03-26') },
  { id: 't1', name: 'First Term', startDate: day('2026-09-07'), endDate: day('2026-12-11') },
  { id: 't3', name: 'Third Term', startDate: day('2027-04-12'), endDate: day('2027-06-30') },
];

describe('dashboard rules', () => {
  it('reports on the term running today, else the last one started, else the first', () => {
    expect(pickTerm(TERMS, day('2026-11-27'))).toMatchObject({ term: { id: 't1' }, current: true });
    expect(pickTerm(TERMS, day('2026-12-20'))).toMatchObject({ term: { id: 't1' }, current: false });
    expect(pickTerm(TERMS, day('2027-04-01'))).toMatchObject({ term: { id: 't2' }, current: false });
    expect(pickTerm(TERMS, day('2026-08-01'))).toMatchObject({ term: { id: 't1' }, current: false });
    expect(pickTerm([], day('2026-11-27'))).toBeNull();
  });

  it('counts assessments by status, per class in level order', () => {
    const classOf = new Map([
      ['f1a', 'c1'],
      ['f1b', 'c1'],
      ['f2a', 'c2'],
    ]);
    const classes = [
      { id: 'c2', name: 'Form 2', level: 2 },
      { id: 'c1', name: 'Form 1', level: 1 },
      { id: 'c3', name: 'Form 3', level: 3 },
    ];
    const result = assessmentProgress(
      [
        { sectionId: 'f1a', status: 'locked' },
        { sectionId: 'f1b', status: 'open' },
        { sectionId: 'f1b', status: 'submitted' },
        { sectionId: 'f2a', status: 'validated' },
        { sectionId: 'gone', status: 'locked' },
      ],
      classOf,
      classes,
    );
    expect(result.overall).toEqual({ total: 5, open: 1, submitted: 1, validated: 1, locked: 2 });
    expect(result.byClass).toEqual([
      { classId: 'c1', name: 'Form 1', total: 3, open: 1, submitted: 1, validated: 0, locked: 1 },
      { classId: 'c2', name: 'Form 2', total: 1, open: 0, submitted: 0, validated: 1, locked: 0 },
    ]);
  });

  it('counts enrolled students, girls and boys, and those without a class', () => {
    const students = [
      { id: 'a', gender: 'female' },
      { id: 'b', gender: 'male' },
      { id: 'c', gender: 'female' },
      { id: 'd', gender: 'male' },
    ];
    expect(studentFigures(students, new Set(['a', 'b', 'c', 'x']))).toEqual({ enrolled: 3, girls: 2, boys: 1, withoutClass: 1 });
  });
});
