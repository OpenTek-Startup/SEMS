import type { ClassView } from '../academic/academic-rules';
import {
  buildGrid,
  checkSubjectInClass,
  checkTeacher,
  classesOf,
  teacherOptions,
  type AssignmentRow,
  type TeacherRow,
} from './teaching-rules';

const teacher = (over: Partial<TeacherRow> = {}): TeacherRow => ({
  id: 't1',
  staffNumber: 'STF-0001',
  firstName: 'Brenda',
  lastName: 'Ngwa',
  position: 'Mathematics teacher',
  category: 'teaching',
  status: 'active',
  ...over,
});

const form1: ClassView = {
  id: 'c1',
  name: 'Form 1',
  level: 1,
  sections: [
    { id: 's1', name: 'A', label: 'Form 1 A', capacity: null },
    { id: 's2', name: 'B', label: 'Form 1 B', capacity: null },
  ],
  subjects: [
    { subjectId: 'eng', code: 'ENG', name: 'English', coefficient: 4 },
    { subjectId: 'math', code: 'MATH', name: 'Mathematics', coefficient: 5 },
  ],
  totalCoefficient: 9,
};

const form2: ClassView = {
  id: 'c2',
  name: 'Form 2',
  level: 2,
  sections: [{ id: 's3', name: 'A', label: 'Form 2 A', capacity: 40 }],
  subjects: [{ subjectId: 'math', code: 'MATH', name: 'Mathematics', coefficient: 5 }],
  totalCoefficient: 5,
};

const brenda = teacher();
const grace = teacher({ id: 't2', staffNumber: 'STF-0003', firstName: 'Grace', lastName: 'Mbah', position: 'English teacher' });

const assignments: AssignmentRow[] = [
  { sectionId: 's1', subjectId: 'math', staffMemberId: 't1' },
  { sectionId: 's3', subjectId: 'math', staffMemberId: 't1' },
  { sectionId: 's1', subjectId: 'eng', staffMemberId: 't2' },
  // stale: the subject was taken off Form 2, or the section is gone
  { sectionId: 's3', subjectId: 'eng', staffMemberId: 't2' },
  { sectionId: 'gone', subjectId: 'math', staffMemberId: 't2' },
];

describe('teaching rules', () => {
  it('builds one cell per section and class subject, with its teacher', () => {
    const grid = buildGrid({ id: 'y1', name: '2026-2027' }, [form1, form2], assignments, [brenda, grace]);
    expect(grid.sections.map((s) => s.label)).toEqual(['Form 1 A', 'Form 1 B', 'Form 2 A']);
    const [f1a, f1b, f2a] = grid.sections;
    expect(f1a.cells.map((c) => [c.code, c.teacher?.fullName ?? null])).toEqual([
      ['ENG', 'Mbah Grace'],
      ['MATH', 'Ngwa Brenda'],
    ]);
    expect(f1b.assigned).toBe(0);
    expect(f2a.cells).toHaveLength(1);
    expect(f2a.cells[0].teacher?.id).toBe('t1');
    expect(grid.total).toBe(5);
    expect(grid.assigned).toBe(3);
  });

  it('marks a teacher who has left as inactive in the grid', () => {
    const grid = buildGrid(null, [form1], assignments, [teacher({ status: 'inactive' }), grace]);
    expect(grid.sections[0].cells[1].teacher).toEqual({ id: 't1', staffNumber: 'STF-0001', fullName: 'Ngwa Brenda', active: false });
  });

  it('offers only active teaching staff, by name, with their load', () => {
    const options = teacherOptions(
      [
        brenda,
        grace,
        teacher({ id: 't3', firstName: 'Peter', lastName: 'Achu', category: 'non_teaching' }),
        teacher({ id: 't4', firstName: 'Rita', lastName: 'Fon', status: 'inactive' }),
      ],
      assignments,
    );
    expect(options.map((o) => [o.fullName, o.load])).toEqual([
      ['Mbah Grace', 3],
      ['Ngwa Brenda', 2],
    ]);
  });

  it('lists the classes of one teacher in class order', () => {
    expect(classesOf('t1', [form1, form2], assignments).map((m) => `${m.label} ${m.code}`)).toEqual([
      'Form 1 A MATH',
      'Form 2 A MATH',
    ]);
    expect(classesOf('t2', [form1, form2], assignments).map((m) => `${m.label} ${m.code}`)).toEqual(['Form 1 A ENG']);
    expect(classesOf('nobody', [form1], assignments)).toEqual([]);
  });

  it('accepts only active teaching staff', () => {
    expect(checkTeacher(brenda)).toBeNull();
    expect(checkTeacher(teacher({ status: 'inactive' }))?.code).toBe('STAFF_INACTIVE');
    expect(checkTeacher(teacher({ category: 'non_teaching' }))?.code).toBe('STAFF_NOT_TEACHING');
  });

  it('accepts only a subject of the class', () => {
    expect(checkSubjectInClass(form1, 'math')).toBeNull();
    expect(checkSubjectInClass(form2, 'eng')?.code).toBe('SUBJECT_NOT_IN_CLASS');
  });
});
