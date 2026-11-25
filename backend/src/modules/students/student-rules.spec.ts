import {
  checkDateOfBirth,
  filterStudents,
  matchesStudent,
  nextMatricule,
  normalizeMatricule,
  toStudentView,
  type StudentRow,
} from './student-rules';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const row = (over: Partial<StudentRow> = {}): StudentRow => ({
  id: 'st1',
  matricule: 'STU-0001',
  firstName: 'Ada',
  lastName: 'Abena',
  gender: 'female',
  dateOfBirth: day('2014-03-02'),
  placeOfBirth: 'Buea',
  guardianName: 'Abena Paul',
  guardianPhone: '+237 677 00 11 22',
  guardianRelationship: 'Father',
  status: 'active',
  admittedOn: day('2026-09-07'),
  ...over,
});

const F1A = { enrollmentId: 'e1', yearId: 'y1', sectionId: 's1', label: 'Form 1 A' };

describe('student rules', () => {
  it('cleans and generates matricules', () => {
    expect(normalizeMatricule('  nf/2026/ 014 ')).toBe('NF/2026/014');
    expect(normalizeMatricule('a')).toBeNull();
    expect(normalizeMatricule('STU_01')).toBeNull();
    expect(nextMatricule([])).toBe('STU-0001');
    expect(nextMatricule(['STU-0001', 'NF/2026/014', 'STU-0012', 'STU-0003'])).toBe('STU-0013');
  });

  it('accepts a plausible date of birth only', () => {
    const today = day('2026-11-23');
    expect(checkDateOfBirth(day('2014-03-02'), today)).toBeNull();
    expect(checkDateOfBirth(day('2062-03-02'), today)?.code).toBe('DATE_OF_BIRTH_INVALID');
    expect(checkDateOfBirth(day('1926-03-02'), today)?.code).toBe('DATE_OF_BIRTH_INVALID');
    expect(checkDateOfBirth(day('2025-01-01'), today)?.code).toBe('DATE_OF_BIRTH_INVALID');
  });

  it('builds the view with the guardian and the current class', () => {
    expect(toStudentView(row(), F1A)).toEqual({
      id: 'st1',
      matricule: 'STU-0001',
      firstName: 'Ada',
      lastName: 'Abena',
      fullName: 'Abena Ada',
      gender: 'female',
      dateOfBirth: '2014-03-02',
      placeOfBirth: 'Buea',
      guardian: { name: 'Abena Paul', phone: '+237 677 00 11 22', relationship: 'Father' },
      status: 'active',
      admittedOn: '2026-09-07',
      current: F1A,
    });
    const bare = toStudentView(row({ guardianName: null, guardianPhone: null, guardianRelationship: null, dateOfBirth: null }), null);
    expect(bare).toMatchObject({ guardian: null, dateOfBirth: null, current: null });
  });

  it('searches names, matricule and guardian, accents ignored', () => {
    const v = toStudentView(row({ firstName: 'Élodie' }), null);
    expect(matchesStudent(v, 'elodie abena')).toBe(true);
    expect(matchesStudent(v, 'stu-0001')).toBe(true);
    expect(matchesStudent(v, 'paul')).toBe(true);
    expect(matchesStudent(v, 'grace')).toBe(false);
    expect(matchesStudent(v, '   ')).toBe(true);
  });

  it('filters by status, class and "no class yet", sorted by name', () => {
    const views = [
      toStudentView(row({ id: 'c', firstName: 'Daniel', lastName: 'Che', matricule: 'STU-0003' }), null),
      toStudentView(row({ id: 'a' }), F1A),
      toStudentView(row({ id: 'b', firstName: 'Clarisse', lastName: 'Bih', matricule: 'STU-0002', status: 'inactive' }), null),
    ];
    expect(filterStudents(views, {}).map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(filterStudents(views, { status: 'active' }).map((v) => v.id)).toEqual(['a', 'c']);
    expect(filterStudents(views, { sectionId: 's1' }).map((v) => v.id)).toEqual(['a']);
    expect(filterStudents(views, { unplaced: true, status: 'active' }).map((v) => v.id)).toEqual(['c']);
    expect(filterStudents(views, { search: 'bih' }).map((v) => v.id)).toEqual(['b']);
  });
});
