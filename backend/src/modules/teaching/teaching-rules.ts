/**
 * Pure rules of teacher assignment, kept free of Nest/Prisma so every rule
 * is unit-tested. Checks return a Problem (or null); the service picks the
 * HTTP status.
 *
 * An assignment says: in this school year, this teacher teaches this
 * subject to this section ("Ngwa Brenda teaches Mathematics to Form 1 A").
 * There is at most one teacher per subject, per section, per year.
 */
import type { ClassView } from '../academic/academic-rules';
import type { Problem } from '../staff/staff-rules';

export type { Problem };

/** A staff record as far as assignment cares. */
export interface TeacherRow {
  id: string;
  staffNumber: string;
  firstName: string;
  lastName: string;
  position: string;
  category: string;
  status: string;
}

export interface AssignmentRow {
  sectionId: string;
  subjectId: string;
  staffMemberId: string;
}

/** A teacher as shown in a cell or a picker. */
export interface TeacherRef {
  id: string;
  staffNumber: string;
  /** "Ngwa Brenda" */
  fullName: string;
  /** false when the teacher has left since being assigned */
  active: boolean;
}

export interface TeacherOption extends TeacherRef {
  position: string;
  /** how many (section, subject) pairs this teacher has in the year */
  load: number;
}

export interface AssignmentCell {
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
  teacher: TeacherRef | null;
}

export interface SectionAssignments {
  sectionId: string;
  classId: string;
  /** "Form 1 A" */
  label: string;
  cells: AssignmentCell[];
  /** cells with a teacher */
  assigned: number;
}

export interface AssignmentGrid {
  year: { id: string; name: string } | null;
  sections: SectionAssignments[];
  /** all cells / cells with a teacher, across the school */
  total: number;
  assigned: number;
}

/** One line of "what do I teach" for a signed-in teacher. */
export interface MyClass {
  sectionId: string;
  classId: string;
  label: string;
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
}

// ------------------------------------------------------------- views

export function toTeacherRef(t: TeacherRow): TeacherRef {
  return { id: t.id, staffNumber: t.staffNumber, fullName: `${t.lastName} ${t.firstName}`, active: t.status === 'active' };
}

function byFullName(a: TeacherRef, b: TeacherRef): number {
  return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }) || a.staffNumber.localeCompare(b.staffNumber);
}

/**
 * Every section of the school (in class level order) with one cell per
 * subject of its class, each holding its teacher or null.
 * Assignments that no longer match a section or a class subject are ignored.
 */
export function buildGrid(
  year: { id: string; name: string } | null,
  classes: readonly ClassView[],
  assignments: readonly AssignmentRow[],
  teachers: readonly TeacherRow[],
): AssignmentGrid {
  const teacherById = new Map(teachers.map((t) => [t.id, toTeacherRef(t)]));
  const key = (sectionId: string, subjectId: string) => `${sectionId}|${subjectId}`;
  const teacherOf = new Map(assignments.map((a) => [key(a.sectionId, a.subjectId), a.staffMemberId]));

  const sections: SectionAssignments[] = [];
  for (const c of classes) {
    for (const s of c.sections) {
      const cells = c.subjects.map((sub) => {
        const staffId = teacherOf.get(key(s.id, sub.subjectId));
        return {
          subjectId: sub.subjectId,
          code: sub.code,
          name: sub.name,
          coefficient: sub.coefficient,
          teacher: staffId ? (teacherById.get(staffId) ?? null) : null,
        };
      });
      sections.push({
        sectionId: s.id,
        classId: c.id,
        label: s.label,
        cells,
        assigned: cells.filter((cell) => cell.teacher).length,
      });
    }
  }
  return {
    year,
    sections,
    total: sections.reduce((n, s) => n + s.cells.length, 0),
    assigned: sections.reduce((n, s) => n + s.assigned, 0),
  };
}

/** Active teaching staff, by name, each with the number of classes they have this year. */
export function teacherOptions(teachers: readonly TeacherRow[], assignments: readonly AssignmentRow[]): TeacherOption[] {
  const load = new Map<string, number>();
  for (const a of assignments) load.set(a.staffMemberId, (load.get(a.staffMemberId) ?? 0) + 1);
  return teachers
    .filter((t) => t.status === 'active' && t.category === 'teaching')
    .map((t) => ({ ...toTeacherRef(t), position: t.position, load: load.get(t.id) ?? 0 }))
    .sort(byFullName);
}

/** The (section, subject) pairs of one teacher, in class order then subject name. */
export function classesOf(
  staffMemberId: string,
  classes: readonly ClassView[],
  assignments: readonly AssignmentRow[],
): MyClass[] {
  const mine = new Set(
    assignments.filter((a) => a.staffMemberId === staffMemberId).map((a) => `${a.sectionId}|${a.subjectId}`),
  );
  const out: MyClass[] = [];
  for (const c of classes) {
    for (const s of c.sections) {
      for (const sub of c.subjects) {
        if (!mine.has(`${s.id}|${sub.subjectId}`)) continue;
        out.push({
          sectionId: s.id,
          classId: c.id,
          label: s.label,
          subjectId: sub.subjectId,
          code: sub.code,
          name: sub.name,
          coefficient: sub.coefficient,
        });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ checks

/** A teacher can be assigned only while active and on the teaching staff. */
export function checkTeacher(t: TeacherRow): Problem | null {
  const name = `${t.lastName} ${t.firstName}`;
  if (t.status !== 'active') {
    return { code: 'STAFF_INACTIVE', message: `${name} is no longer active and cannot be given classes.` };
  }
  if (t.category !== 'teaching') {
    return { code: 'STAFF_NOT_TEACHING', message: `${name} is not on the teaching staff.` };
  }
  return null;
}

/** The subject must be one of the subjects of the section's class. */
export function checkSubjectInClass(
  schoolClass: Pick<ClassView, 'name' | 'subjects'>,
  subjectId: string,
): Problem | null {
  if (schoolClass.subjects.some((s) => s.subjectId === subjectId)) return null;
  return {
    code: 'SUBJECT_NOT_IN_CLASS',
    message: `This subject is not taught in ${schoolClass.name}. Add it to the class subjects first.`,
  };
}

