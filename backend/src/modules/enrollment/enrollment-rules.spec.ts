import {
  checkCapacity,
  checkInYear,
  checkNotBefore,
  countBySection,
  defaultDay,
  duplicateIds,
  sortEnrollments,
  toEnrollmentView,
  toRoster,
  type EnrollmentRow,
  type RosterStudent,
} from './enrollment-rules';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const YEAR = { name: '2026-2027', startDate: day('2026-09-07'), endDate: day('2027-06-30') };

const ada: RosterStudent = { studentId: 'ada', matricule: 'STU-0001', firstName: 'Ada', lastName: 'Abena', gender: 'female' };
const che: RosterStudent = { studentId: 'che', matricule: 'STU-0003', firstName: 'Daniel', lastName: 'Che', gender: 'male' };
const bih: RosterStudent = { studentId: 'bih', matricule: 'STU-0002', firstName: 'Clarisse', lastName: 'Bih', gender: 'female' };

describe('enrollment rules', () => {
  it('uses today, kept inside the school year', () => {
    expect(defaultDay(YEAR, day('2026-11-23'))).toEqual(day('2026-11-23'));
    expect(defaultDay(YEAR, day('2026-08-15'))).toEqual(day('2026-09-07'));
    expect(defaultDay(YEAR, day('2027-08-01'))).toEqual(day('2027-06-30'));
  });

  it('checks dates against the year and the day the student joined', () => {
    expect(checkInYear(day('2026-09-07'), YEAR)).toBeNull();
    expect(checkInYear(day('2027-06-30'), YEAR)).toBeNull();
    expect(checkInYear(day('2027-07-01'), YEAR)).toMatchObject({
      code: 'DATE_OUTSIDE_YEAR',
      message: '2027-07-01 is outside the school year 2026-2027 (2026-09-07 to 2027-06-30).',
    });
    expect(checkNotBefore(day('2026-10-01'), day('2026-09-07'))).toBeNull();
    expect(checkNotBefore(day('2026-09-07'), day('2026-09-07'))).toBeNull();
    expect(checkNotBefore(day('2026-09-06'), day('2026-09-07'))?.code).toBe('DATE_BEFORE_ENROLLMENT');
  });

  it('keeps a section within its capacity', () => {
    expect(checkCapacity('Form 1 A', null, 80, 5)).toBeNull();
    expect(checkCapacity('Form 1 A', 50, 45, 5)).toBeNull();
    expect(checkCapacity('Form 1 A', 50, 48, 5)).toMatchObject({
      code: 'SECTION_FULL',
      message: 'Form 1 A has only 2 free places (capacity 50).',
      free: 2,
    });
    expect(checkCapacity('Form 1 A', 50, 49, 2)?.message).toBe('Form 1 A has only 1 free place (capacity 50).');
    expect(checkCapacity('Form 1 A', 50, 50, 1)?.message).toBe('Form 1 A is full (50 places).');
  });

  it('finds ids given twice', () => {
    expect(duplicateIds(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicateIds(['a', 'b'])).toEqual([]);
  });

  it('builds views, active first then by name', () => {
    const row = (over: Partial<EnrollmentRow>): EnrollmentRow => ({
      id: 'e',
      academicYearId: 'y1',
      studentId: 'ada',
      sectionId: 's1',
      status: 'active',
      enrolledOn: day('2026-09-07'),
      leftOn: null,
      reason: null,
      ...over,
    });
    const students = new Map([ada, bih, che].map((s) => [s.studentId, s]));
    const labels = new Map([['s1', 'Form 1 A']]);
    const v = toEnrollmentView(row({ id: 'e1', status: 'withdrawn', leftOn: day('2026-11-02'), reason: 'Moved to Douala' }), students, labels);
    expect(v).toEqual({
      id: 'e1',
      yearId: 'y1',
      status: 'withdrawn',
      enrolledOn: '2026-09-07',
      leftOn: '2026-11-02',
      reason: 'Moved to Douala',
      section: { id: 's1', label: 'Form 1 A' },
      student: { id: 'ada', matricule: 'STU-0001', fullName: 'Abena Ada', gender: 'female' },
    });
    const views = [
      v,
      toEnrollmentView(row({ id: 'e2', studentId: 'che' }), students, labels),
      toEnrollmentView(row({ id: 'e3', studentId: 'bih' }), students, labels),
    ];
    expect(sortEnrollments(views).map((x) => x.id)).toEqual(['e3', 'e2', 'e1']);
  });

  it('counts each section, with boys and girls', () => {
    const sections = [
      { id: 's1', classId: 'c1', label: 'Form 1 A', capacity: 50 },
      { id: 's2', classId: 'c1', label: 'Form 1 B', capacity: null },
    ];
    expect(
      countBySection(sections, [
        { sectionId: 's1', gender: 'female' },
        { sectionId: 's1', gender: 'male' },
        { sectionId: 's1', gender: 'female' },
      ]),
    ).toEqual([
      { sectionId: 's1', classId: 'c1', label: 'Form 1 A', capacity: 50, enrolled: 3, boys: 1, girls: 2 },
      { sectionId: 's2', classId: 'c1', label: 'Form 1 B', capacity: null, enrolled: 0, boys: 0, girls: 0 },
    ]);
  });

  it('sorts a class list by name', () => {
    expect(toRoster([che, ada, bih]).map((s) => s.fullName)).toEqual(['Abena Ada', 'Bih Clarisse', 'Che Daniel']);
  });
});
