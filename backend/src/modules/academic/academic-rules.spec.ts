import {
  assembleClasses,
  checkRange,
  checkYearLength,
  cleanName,
  duplicates,
  findOverlap,
  formatDay,
  nameTaken,
  normalizeSubjectCode,
  parseDay,
  termsOutside,
  toSectionList,
  toSubjectViews,
  toYearViews,
} from './academic-rules';

const d = (s: string) => parseDay(s)!;
const range = (start: string, end: string) => ({ startDate: d(start), endDate: d(end) });

describe('academic rules', () => {
  it('reads and writes calendar days, refusing impossible dates', () => {
    expect(formatDay(d('2026-09-07'))).toBe('2026-09-07');
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('7/9/2026')).toBeNull();
    expect(parseDay('2028-02-29')).not.toBeNull();
  });

  it('checks date ranges and the length of a year', () => {
    expect(checkRange(range('2026-09-07', '2027-06-30'))).toBeNull();
    expect(checkRange(range('2026-09-07', '2026-09-07'))?.code).toBe('DATES_INVALID');
    expect(checkRange(range('2027-06-30', '2026-09-07'))?.code).toBe('DATES_INVALID');
    expect(checkYearLength(range('2026-09-07', '2027-06-30'))).toBeNull();
    expect(checkYearLength(range('2026-09-07', '2028-06-30'))?.code).toBe('YEAR_TOO_LONG');
  });

  it('finds overlapping periods (both ends included) and terms outside a year', () => {
    const terms = [
      { id: 't1', name: 'Term 1', ...range('2026-09-07', '2026-12-11') },
      { id: 't2', name: 'Term 2', ...range('2027-01-04', '2027-03-26') },
    ];
    expect(findOverlap(range('2026-12-11', '2026-12-20'), terms)?.id).toBe('t1');
    expect(findOverlap(range('2026-12-12', '2027-01-03'), terms)).toBeUndefined();
    expect(findOverlap(range('2026-09-07', '2026-12-11'), terms, 't1')).toBeUndefined();
    expect(termsOutside(range('2026-09-01', '2027-02-28'), terms)).toEqual(['Term 2']);
  });

  it('compares names without regard to case or extra spaces', () => {
    expect(cleanName('  Form   1 ')).toBe('Form 1');
    const classes = [{ id: 'c1', name: 'Form 1' }];
    expect(nameTaken('form 1', classes, (c) => c.name)?.id).toBe('c1');
    expect(nameTaken('form 1', classes, (c) => c.name, 'c1')).toBeUndefined();
    expect(nameTaken('Form 2', classes, (c) => c.name)).toBeUndefined();
  });

  it('normalizes subject codes and spots duplicates', () => {
    expect(normalizeSubjectCode(' math ')).toBe('MATH');
    expect(normalizeSubjectCode('ICT-2')).toBe('ICT-2');
    expect(normalizeSubjectCode('')).toBeNull();
    expect(normalizeSubjectCode('MATHS AND MORE')).toBeNull();
    expect(duplicates(['a', 'b', 'a'])).toEqual(['a']);
  });

  it('builds years newest first, with terms in order and the current term marked', () => {
    const years = [
      { id: 'y1', name: '2025-2026', isCurrent: false, ...range('2025-09-08', '2026-06-30') },
      { id: 'y2', name: '2026-2027', isCurrent: true, ...range('2026-09-07', '2027-06-30') },
    ];
    const terms = [
      { id: 't2', academicYearId: 'y2', name: 'Term 2', ...range('2027-01-04', '2027-03-26') },
      { id: 't1', academicYearId: 'y2', name: 'Term 1', ...range('2026-09-07', '2026-12-11') },
    ];
    const views = toYearViews(years, terms, new Date('2026-10-16T10:00:00Z'));
    expect(views.map((y) => y.name)).toEqual(['2026-2027', '2025-2026']);
    expect(views[0].terms.map((t) => [t.name, t.isCurrent])).toEqual([
      ['Term 1', true],
      ['Term 2', false],
    ]);
    expect(views[0].startDate).toBe('2026-09-07');
    expect(views[1].terms).toEqual([]);
  });

  it('assembles classes in level order with sections, subjects and the total coefficient', () => {
    const classes = [
      { id: 'c2', name: 'Form 2', level: 2 },
      { id: 'c1', name: 'Form 1', level: 1 },
    ];
    const sections = [
      { id: 's2', classId: 'c1', name: 'B', capacity: null },
      { id: 's1', classId: 'c1', name: 'A', capacity: 45 },
    ];
    const subjects = [
      { id: 'm', code: 'MATH', name: 'Mathematics' },
      { id: 'e', code: 'ENG', name: 'English' },
    ];
    const classSubjects = [
      { classId: 'c1', subjectId: 'm', coefficient: 4 },
      { classId: 'c1', subjectId: 'e', coefficient: 3 },
    ];
    const views = assembleClasses(classes, sections, classSubjects, subjects);
    expect(views.map((c) => c.name)).toEqual(['Form 1', 'Form 2']);
    expect(views[0].sections.map((s) => s.label)).toEqual(['Form 1 A', 'Form 1 B']);
    expect(views[0].subjects.map((s) => s.code)).toEqual(['ENG', 'MATH']);
    expect(views[0].totalCoefficient).toBe(7);
    expect(views[1]).toMatchObject({ sections: [], subjects: [], totalCoefficient: 0 });

    expect(toSectionList(classes, sections).map((s) => s.label)).toEqual(['Form 1 A', 'Form 1 B']);
    expect(toSubjectViews(subjects, classSubjects)).toEqual([
      { id: 'e', code: 'ENG', name: 'English', classCount: 1 },
      { id: 'm', code: 'MATH', name: 'Mathematics', classCount: 1 },
    ]);
  });
});
