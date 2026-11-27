/**
 * YESE development seed — safe to run many times (everything is upserted).
 *
 * Creates:
 *  - the module catalogue and the permission catalogue
 *  - one platform Super Admin
 *  - two demo schools (Northfield, Sunrise) from SRS v1.2 §3.3
 *  - the four base roles per school, plus an "Exam Officer" custom role at Northfield
 *  - one administrator account per school
 *  - a demo academic structure for Northfield (year, terms, classes, sections, subjects)
 *  - demo staff records for Northfield, and the teacher account of Ngwa Brenda
 *  - demo teacher assignments for Northfield (2026-2027)
 *  - demo assessments for Northfield: Sequences 1 and 2 of the First Term, for every assigned class
 *  - demo students for Northfield, enrolled in Form 1 A, Form 1 B and Form 2 A (2026-2027)
 *  - demo marks: Sequence 1 marked and locked (so Results shows a ranking), Sequence 2 being marked
 *  - Form 1 A complete for the First Term (both sequences locked), so its results can be published in a demo
 *
 * Passwords: set SEED_DEFAULT_PASSWORD in .env to choose one. Otherwise a random
 * password is generated and printed ONCE at the end. Every seeded account must
 * change its password at first sign-in.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type {
  InstitutionType,
  ModuleCategory,
  RoleArchetype,
} from '../src/generated/prisma/enums';
import { BASE_ROLES, TEACHER_PERMISSIONS } from '../src/core/tenancy/school-template';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// ------------------------------------------------------------ catalogues

const MODULES: {
  code: string;
  name: string;
  category: ModuleCategory;
  description: string;
  dependsOn: string[];
}[] = [
  { code: 'core', name: 'Core platform', category: 'core', description: 'Tenancy, users, roles, settings, audit', dependsOn: [] },
  { code: 'student', name: 'Students', category: 'business', description: 'Student and guardian registry', dependsOn: [] },
  { code: 'staff', name: 'Staff', category: 'business', description: 'Teaching and non-teaching staff', dependsOn: [] },
  { code: 'academic', name: 'Academic structure', category: 'business', description: 'Years, terms, classes, subjects', dependsOn: [] },
  { code: 'enrollment', name: 'Enrollment', category: 'business', description: 'Students into sections per year', dependsOn: ['student', 'academic'] },
  { code: 'attendance', name: 'Attendance', category: 'business', description: 'Registers and attendance reports', dependsOn: ['enrollment'] },
  { code: 'assessment', name: 'Assessment', category: 'business', description: 'Assessments, marks, validation, locking', dependsOn: ['academic', 'enrollment'] },
  { code: 'results', name: 'Results & report cards', category: 'business', description: 'Averages, ranks, report cards', dependsOn: ['assessment'] },
  { code: 'finance', name: 'Finance', category: 'business', description: 'Fees, invoices, payments, receipts', dependsOn: ['student'] },
  { code: 'comms', name: 'Communication', category: 'extension', description: 'Notifications, announcements, parent portal', dependsOn: ['student'] },
];

/**
 * Demo activations (Module Registry). Core is always on and not listed.
 * Northfield runs the full academic chain; Sunrise has only just started.
 */
const ACTIVE_MODULES: Record<string, string[]> = {
  northfield: ['student', 'staff', 'academic', 'enrollment', 'attendance', 'assessment', 'results'],
  sunrise: ['student', 'staff', 'academic'],
};

// code -> description. The module is the first segment of the code.
const PERMISSIONS: Record<string, string> = {
  'core.user.view': 'View user accounts',
  'core.user.manage': 'Create, edit and disable user accounts',
  'core.role.manage': 'Create and edit custom roles and assign roles',
  'core.settings.manage': 'Change school settings',
  'core.audit.view': 'View the audit log',
  'student.record.view': 'View student records',
  'student.record.edit': 'Create and edit students',
  'student.guardian.manage': 'Manage guardians',
  'staff.record.view': 'View staff records',
  'staff.record.edit': 'Create and edit staff',
  'academic.structure.view': 'View years, terms, classes and subjects',
  'academic.structure.manage': 'Manage years, classes and subjects',
  'academic.teacher.assign': 'Assign teachers to subjects and sections',
  'enrollment.enroll': 'Enroll students',
  'enrollment.withdraw': 'Withdraw students',
  'attendance.register.take': 'Take attendance registers',
  'attendance.register.edit_late': 'Edit past registers',
  'attendance.report.view': 'View attendance reports',
  'assessment.create': 'Create assessments',
  'assessment.marks.enter': 'Enter marks',
  'assessment.marks.validate': 'Validate marks',
  'assessment.marks.lock': 'Lock marks',
  'assessment.marks.override': 'Change a locked mark',
  'results.compute': 'Compute results',
  'results.reportcard.generate': 'Generate report cards',
  'results.publish': 'Publish results',
  'finance.fees.manage': 'Manage fee structures',
  'finance.payment.record': 'Record payments',
  'finance.payment.void': 'Void or reverse payments',
  'finance.report.view': 'View finance reports',
};

const EXAM_OFFICER_PERMISSIONS = [
  'student.record.view',
  'academic.structure.view',
  'attendance.report.view',
  'assessment.marks.validate',
  'assessment.marks.lock',
  'assessment.marks.override',
  'results.compute',
  'results.reportcard.generate',
  'results.publish',
];

const SCHOOLS: { slug: string; name: string; type: InstitutionType; adminEmail: string; adminFirst: string; adminLast: string }[] = [
  { slug: 'northfield', name: 'Northfield Bilingual College', type: 'secondary', adminEmail: 'admin@northfield.school', adminFirst: 'M.', adminLast: 'Ndzana' },
  { slug: 'sunrise', name: 'Sunrise Comprehensive College', type: 'secondary', adminEmail: 'admin@sunrise.school', adminFirst: 'School', adminLast: 'Administrator' },
];

/** Northfield's demo academic structure (only missing rows are created). */
const DEMO_YEAR = { name: '2026-2027', start: '2026-09-07', end: '2027-06-30' };
const DEMO_TERMS = [
  { name: 'First Term', start: '2026-09-07', end: '2026-12-11' },
  { name: 'Second Term', start: '2027-01-04', end: '2027-03-26' },
  { name: 'Third Term', start: '2027-04-12', end: '2027-06-30' },
];
const DEMO_SUBJECTS: [code: string, name: string][] = [
  ['MATH', 'Mathematics'],
  ['ENG', 'English Language'],
  ['FRE', 'French'],
  ['PHY', 'Physics'],
  ['CHEM', 'Chemistry'],
  ['BIO', 'Biology'],
  ['HIST', 'History'],
  ['GEO', 'Geography'],
  ['CS', 'Computer Science'],
  ['CIV', 'Citizenship Education'],
];
const LOWER_COEFFICIENTS: Record<string, number> = {
  MATH: 4, ENG: 4, FRE: 3, PHY: 2, CHEM: 2, BIO: 2, HIST: 2, GEO: 2, CS: 2, CIV: 1,
};
const SIXTH_COEFFICIENTS: Record<string, number> = { MATH: 5, PHY: 5, CHEM: 4, BIO: 4, CS: 3, ENG: 2, FRE: 2 };
const DEMO_CLASSES: { name: string; level: number; sections: string[]; coefficients: Record<string, number> }[] = [
  { name: 'Form 1', level: 1, sections: ['A', 'B'], coefficients: LOWER_COEFFICIENTS },
  { name: 'Form 2', level: 2, sections: ['A', 'B'], coefficients: LOWER_COEFFICIENTS },
  { name: 'Form 3', level: 3, sections: ['A'], coefficients: LOWER_COEFFICIENTS },
  { name: 'Form 4', level: 4, sections: ['A'], coefficients: LOWER_COEFFICIENTS },
  { name: 'Form 5', level: 5, sections: ['A'], coefficients: LOWER_COEFFICIENTS },
  { name: 'Lower Sixth', level: 6, sections: ['Science'], coefficients: SIXTH_COEFFICIENTS },
  { name: 'Upper Sixth', level: 7, sections: ['Science'], coefficients: SIXTH_COEFFICIENTS },
];

/** Northfield's demo staff (only missing staff numbers are created). */
const DEMO_STAFF: {
  staffNumber: string;
  firstName: string;
  lastName: string;
  position: string;
  category: 'teaching' | 'non_teaching';
  hireDate: string;
}[] = [
  { staffNumber: 'STF-0001', firstName: 'Brenda', lastName: 'Ngwa', position: 'Mathematics teacher', category: 'teaching', hireDate: '2019-09-02' },
  { staffNumber: 'STF-0002', firstName: 'Emmanuel', lastName: 'Tabi', position: 'Physics teacher', category: 'teaching', hireDate: '2021-09-06' },
  { staffNumber: 'STF-0003', firstName: 'Grace', lastName: 'Mbah', position: 'English Language teacher', category: 'teaching', hireDate: '2018-09-03' },
  { staffNumber: 'STF-0004', firstName: 'Julien', lastName: 'Essomba', position: 'French teacher', category: 'teaching', hireDate: '2022-09-05' },
  { staffNumber: 'STF-0005', firstName: 'Rita', lastName: 'Fon', position: 'Chemistry teacher', category: 'teaching', hireDate: '2020-09-07' },
  { staffNumber: 'STF-0006', firstName: 'Peter', lastName: 'Achu', position: 'Bursar', category: 'non_teaching', hireDate: '2017-01-09' },
  { staffNumber: 'STF-0007', firstName: 'Mercy', lastName: 'Ndi', position: 'Secretary', category: 'non_teaching', hireDate: '2023-02-01' },
];

/** Who teaches each subject at Northfield in the demo year (by staff number). */
const DEMO_TEACHERS: Record<string, string> = {
  MATH: 'STF-0001',
  PHY: 'STF-0002',
  ENG: 'STF-0003',
  FRE: 'STF-0004',
  CHEM: 'STF-0005',
};

/** A demo teacher account, linked to STF-0001, to try "my classes", registers and marks. */
const DEMO_TEACHER_ACCOUNT = { email: 'b.ngwa@northfield.school', firstName: 'Brenda', lastName: 'Ngwa', staffNumber: 'STF-0001' };

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@yese.local';

// --------------------------------------------------------------- helpers

async function upsertUser(params: {
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  isSuperAdmin?: boolean;
}) {
  // findFirst instead of upsert: the (tenant_id, email) key cannot match NULL tenant_id.
  const existing = await prisma.user.findFirst({
    where: { tenantId: params.tenantId, email: params.email },
  });
  if (existing) return { user: existing, created: false };
  const user = await prisma.user.create({
    data: {
      tenantId: params.tenantId,
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      passwordHash: params.passwordHash,
      isSuperAdmin: params.isSuperAdmin ?? false,
      mustChangePassword: true,
    },
  });
  return { user, created: true };
}

async function grant(tenantId: string, roleId: string, codes: readonly string[], permissionIds: Map<string, string>) {
  await prisma.rolePermission.createMany({
    data: codes.map((code) => {
      const permissionId = permissionIds.get(code);
      if (!permissionId) throw new Error(`Unknown permission code: ${code}`);
      return { roleId, permissionId, tenantId };
    }),
    skipDuplicates: true,
  });
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Demo academic structure; never overwrites what the school changed. */
async function seedAcademic(tenantId: string) {
  const hasCurrent = await prisma.academicYear.findFirst({ where: { tenantId, isCurrent: true } });
  const year = await prisma.academicYear.upsert({
    where: { tenantId_name: { tenantId, name: DEMO_YEAR.name } },
    update: {},
    create: { tenantId, name: DEMO_YEAR.name, startDate: day(DEMO_YEAR.start), endDate: day(DEMO_YEAR.end), isCurrent: !hasCurrent },
  });
  for (const t of DEMO_TERMS) {
    await prisma.term.upsert({
      where: { academicYearId_name: { academicYearId: year.id, name: t.name } },
      update: {},
      create: { tenantId, academicYearId: year.id, name: t.name, startDate: day(t.start), endDate: day(t.end) },
    });
  }

  const subjectIds = new Map<string, string>();
  for (const [code, name] of DEMO_SUBJECTS) {
    const subject = await prisma.subject.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { tenantId, code, name },
    });
    subjectIds.set(code, subject.id);
  }

  for (const c of DEMO_CLASSES) {
    const schoolClass = await prisma.schoolClass.upsert({
      where: { tenantId_name: { tenantId, name: c.name } },
      update: {},
      create: { tenantId, name: c.name, level: c.level },
    });
    for (const name of c.sections) {
      await prisma.section.upsert({
        where: { classId_name: { classId: schoolClass.id, name } },
        update: {},
        create: { tenantId, classId: schoolClass.id, name, capacity: 50 },
      });
    }
    await prisma.classSubject.createMany({
      data: Object.entries(c.coefficients).map(([code, coefficient]) => ({
        tenantId,
        classId: schoolClass.id,
        subjectId: subjectIds.get(code)!,
        coefficient,
      })),
      skipDuplicates: true,
    });
  }
}

/** Demo staff records; never overwrites what the school changed. */
async function seedStaff(tenantId: string) {
  for (const s of DEMO_STAFF) {
    await prisma.staffMember.upsert({
      where: { tenantId_staffNumber: { tenantId, staffNumber: s.staffNumber } },
      update: {},
      create: { tenantId, ...s, hireDate: day(s.hireDate) },
    });
  }
}

/**
 * Demo teacher assignments for the demo year: each subject of DEMO_TEACHERS
 * goes to its teacher in every section whose class studies it. Only empty
 * cells are filled, so the school's own choices are kept.
 */
async function seedTeaching(tenantId: string) {
  const year = await prisma.academicYear.findFirst({ where: { tenantId, name: DEMO_YEAR.name }, select: { id: true } });
  if (!year) return;
  const [staff, subjects, sections, classSubjects] = await Promise.all([
    prisma.staffMember.findMany({ where: { tenantId, status: 'active', category: 'teaching' }, select: { id: true, staffNumber: true } }),
    prisma.subject.findMany({ where: { tenantId }, select: { id: true, code: true } }),
    prisma.section.findMany({ where: { tenantId }, select: { id: true, classId: true } }),
    prisma.classSubject.findMany({ where: { tenantId }, select: { classId: true, subjectId: true } }),
  ]);
  const staffId = new Map(staff.map((s) => [s.staffNumber, s.id]));
  const subjectCode = new Map(subjects.map((s) => [s.id, s.code]));

  const data: { tenantId: string; academicYearId: string; sectionId: string; subjectId: string; staffMemberId: string }[] = [];
  for (const section of sections) {
    for (const cs of classSubjects.filter((c) => c.classId === section.classId)) {
      const number = DEMO_TEACHERS[subjectCode.get(cs.subjectId) ?? ''];
      const teacher = number ? staffId.get(number) : undefined;
      if (teacher) {
        data.push({ tenantId, academicYearId: year.id, sectionId: section.id, subjectId: cs.subjectId, staffMemberId: teacher });
      }
    }
  }
  // (year, section, subject) is unique: cells that already have a teacher are skipped.
  await prisma.teacherAssignment.createMany({ data, skipDuplicates: true });
}

/** Demo students: built from these names, so the class lists look real and stay the same on every run. */
const GIRLS = ['Ada', 'Clarisse', 'Mirabel', 'Brenda', 'Precious', 'Linda', 'Sandrine', 'Gladys', 'Vanessa', 'Blessing', 'Nadege', 'Ruth', 'Esther', 'Joy', 'Larissa'];
const BOYS = ['Daniel', 'Samuel', 'Emmanuel', 'Junior', 'Kevin', 'Brice', 'Rodrigue', 'Collins', 'Franck', 'Divine', 'Ivan', 'Arnold', 'Boris', 'Hilary', 'Clovis'];
const FAMILY = ['Abena', 'Bih', 'Che', 'Eto', 'Fai', 'Ngu', 'Tabe', 'Mbah', 'Nkeng', 'Fonkwo', 'Atanga', 'Ewane', 'Ndip', 'Akum', 'Tanyi', 'Nkwenti', 'Muma', 'Ayuk', 'Ebai', 'Ngole'];
const TOWNS = ['Buea', 'Limbe', 'Bamenda', 'Kumba', 'Douala', 'Yaounde', 'Tiko', 'Mamfe'];
/** section label -> how many students, born in which year */
const DEMO_ENROLLMENT: { cls: string; section: string; count: number; born: number }[] = [
  { cls: 'Form 1', section: 'A', count: 20, born: 2014 },
  { cls: 'Form 1', section: 'B', count: 18, born: 2014 },
  { cls: 'Form 2', section: 'A', count: 20, born: 2013 },
];

/** Demo students and their enrollment; existing matricules and enrollments are kept. */
async function seedStudents(tenantId: string) {
  const year = await prisma.academicYear.findFirst({ where: { tenantId, name: DEMO_YEAR.name }, select: { id: true } });
  if (!year) return;
  let n = 0;
  for (const group of DEMO_ENROLLMENT) {
    const schoolClass = await prisma.schoolClass.findFirst({ where: { tenantId, name: group.cls }, select: { id: true } });
    const section = schoolClass
      ? await prisma.section.findFirst({ where: { classId: schoolClass.id, name: group.section }, select: { id: true } })
      : null;
    for (let i = 0; i < group.count; i++, n++) {
      const girl = n % 2 === 0;
      const firstName = (girl ? GIRLS : BOYS)[Math.floor(n / 2) % 15];
      const lastName = FAMILY[(n * 7) % FAMILY.length];
      const matricule = `STU-${String(n + 1).padStart(4, '0')}`;
      const student = await prisma.student.upsert({
        where: { tenantId_matricule: { tenantId, matricule } },
        update: {},
        create: {
          tenantId,
          matricule,
          firstName,
          lastName,
          gender: girl ? 'female' : 'male',
          dateOfBirth: day(`${group.born}-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 27) + 1).padStart(2, '0')}`),
          placeOfBirth: TOWNS[n % TOWNS.length],
          guardianName: `${lastName} ${girl ? BOYS[(n + 3) % 15] : GIRLS[(n + 5) % 15]}`,
          guardianPhone: `+237 6${70 + (n % 30)} ${String(10 + (n % 90)).padStart(2, '0')} ${String(20 + ((n * 3) % 80)).padStart(2, '0')} ${String(30 + ((n * 7) % 70)).padStart(2, '0')}`,
          guardianRelationship: girl ? 'Father' : 'Mother',
          admittedOn: day(DEMO_YEAR.start),
        },
      });
      if (!section) continue;
      const enrolled = await prisma.enrollment.findFirst({ where: { academicYearId: year.id, studentId: student.id }, select: { id: true } });
      if (!enrolled) {
        await prisma.enrollment.create({
          data: { tenantId, academicYearId: year.id, studentId: student.id, sectionId: section.id, enrolledOn: day(DEMO_YEAR.start) },
        });
      }
    }
  }
}

/** The two sequences of the First Term (Cameroon: two sequences per term, marked out of 20). */
const DEMO_SEQUENCES = [
  { name: 'Sequence 1', heldOn: '2026-10-12' },
  { name: 'Sequence 2', heldOn: '2026-11-16' },
];

/** Demo assessments: one per sequence for each assigned class; existing ones are kept. */
async function seedAssessments(tenantId: string) {
  const year = await prisma.academicYear.findFirst({ where: { tenantId, name: DEMO_YEAR.name }, select: { id: true } });
  if (!year) return;
  const term = await prisma.term.findFirst({ where: { academicYearId: year.id, name: DEMO_TERMS[0].name }, select: { id: true } });
  if (!term) return;
  const cells = await prisma.teacherAssignment.findMany({
    where: { tenantId, academicYearId: year.id },
    select: { sectionId: true, subjectId: true },
  });
  await prisma.assessment.createMany({
    data: cells.flatMap((c) =>
      DEMO_SEQUENCES.map((q) => ({
        tenantId,
        academicYearId: year.id,
        termId: term.id,
        sectionId: c.sectionId,
        subjectId: c.subjectId,
        name: q.name,
        heldOn: day(q.heldOn),
      })),
    ),
    // (term, section, subject, name) is unique: sequences that exist are skipped.
    skipDuplicates: true,
  });
}

/** A stable pseudo-random number in [0, 1) from a text (same marks on every run). */
function noise(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** One demo mark: the same student does well or badly across subjects, a few are absent. */
function demoMark(tenantId: string, a: { id: string; maxScore: number }, studentId: string) {
  const ability = noise(studentId);
  const luck = noise(`${studentId}|${a.id}`);
  const absent = luck > 0.97;
  const raw = 4 + ability * 11 + luck * 5; // 4 to 20
  return {
    tenantId,
    assessmentId: a.id,
    studentId,
    absent,
    score: absent ? null : Math.min(a.maxScore, Math.round(raw * 2) / 2),
  };
}

/**
 * Demo marks for Northfield's First Term. Sequence 1: every student marked
 * (a few absent), then locked. Sequence 2: marked except the last students
 * of each list, still open, so a teacher can finish and submit it.
 * Assessments that already have marks, or were moved on by the school, are left alone.
 */
async function seedMarks(tenantId: string) {
  const year = await prisma.academicYear.findFirst({ where: { tenantId, name: DEMO_YEAR.name }, select: { id: true } });
  if (!year) return;
  const assessments = await prisma.assessment.findMany({
    where: { tenantId, academicYearId: year.id, status: 'open', name: { in: DEMO_SEQUENCES.map((q) => q.name) } },
    select: { id: true, name: true, sectionId: true, subjectId: true, maxScore: true },
  });
  const now = new Date();
  for (const a of assessments) {
    if ((await prisma.mark.count({ where: { assessmentId: a.id } })) > 0) continue;
    const enrolled = await prisma.enrollment.findMany({
      where: { academicYearId: year.id, sectionId: a.sectionId, status: 'active' },
      select: { studentId: true },
      orderBy: { studentId: 'asc' },
    });
    if (enrolled.length === 0) continue;
    const first = a.name === DEMO_SEQUENCES[0].name;
    const marked = first ? enrolled : enrolled.slice(0, Math.max(0, enrolled.length - 3));
    await prisma.mark.createMany({
      data: marked.map((e) => demoMark(tenantId, a, e.studentId)),
      skipDuplicates: true,
    });
    if (first) {
      await prisma.assessment.update({
        where: { id: a.id },
        data: { status: 'locked', submittedAt: now, validatedAt: now, lockedAt: now },
      });
    }
  }
}

/** The demo class whose First Term is complete, so its results can be published during a demo. */
const READY_SECTION = { cls: 'Form 1', section: 'A' };

/**
 * Completes the First Term of Form 1 A: its open sequences get the missing
 * marks and are locked. The results stay unpublished: publishing is done in the demo.
 * Assessments the school has already submitted, validated or locked are left alone.
 */
async function seedReadyClass(tenantId: string) {
  const year = await prisma.academicYear.findFirst({ where: { tenantId, name: DEMO_YEAR.name }, select: { id: true } });
  const schoolClass = await prisma.schoolClass.findFirst({ where: { tenantId, name: READY_SECTION.cls }, select: { id: true } });
  if (!year || !schoolClass) return;
  const section = await prisma.section.findFirst({ where: { classId: schoolClass.id, name: READY_SECTION.section }, select: { id: true } });
  if (!section) return;
  const enrolled = await prisma.enrollment.findMany({
    where: { academicYearId: year.id, sectionId: section.id, status: 'active' },
    select: { studentId: true },
  });
  if (enrolled.length === 0) return;
  const open = await prisma.assessment.findMany({
    where: { tenantId, academicYearId: year.id, sectionId: section.id, status: 'open', name: { in: DEMO_SEQUENCES.map((q) => q.name) } },
    select: { id: true, maxScore: true },
  });
  const now = new Date();
  for (const a of open) {
    // (assessment, student) is unique: marks already entered are kept.
    await prisma.mark.createMany({
      data: enrolled.map((e) => demoMark(tenantId, a, e.studentId)),
      skipDuplicates: true,
    });
    await prisma.assessment.update({
      where: { id: a.id },
      data: { status: 'locked', submittedAt: now, validatedAt: now, lockedAt: now },
    });
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const password = process.env.SEED_DEFAULT_PASSWORD ?? randomBytes(9).toString('base64url');
  const passwordHash = await hash(password);
  const createdAccounts: string[] = [];

  // 1. Modules
  const moduleIds = new Map<string, string>();
  for (const m of MODULES) {
    const row = await prisma.module.upsert({
      where: { code: m.code },
      update: { name: m.name, category: m.category, description: m.description, dependsOn: m.dependsOn },
      create: m,
    });
    moduleIds.set(m.code, row.id);
  }

  // 2. Permissions
  const permissionIds = new Map<string, string>();
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    const moduleCode = code.split('.')[0];
    const moduleId = moduleIds.get(moduleCode);
    if (!moduleId) throw new Error(`Permission ${code} refers to unknown module ${moduleCode}`);
    const row = await prisma.permission.upsert({
      where: { code },
      update: { description, moduleId },
      create: { code, description, moduleId },
    });
    permissionIds.set(code, row.id);
  }

  // 3. Platform Super Admin
  const superAdmin = await upsertUser({
    tenantId: null,
    email: SUPER_ADMIN_EMAIL,
    firstName: 'Platform',
    lastName: 'Super Admin',
    passwordHash,
    isSuperAdmin: true,
  });
  if (superAdmin.created) createdAccounts.push(`${SUPER_ADMIN_EMAIL}  (Super Admin)`);

  // 4. Schools, base roles, admins
  for (const s of SCHOOLS) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: s.slug },
      update: { name: s.name, type: s.type },
      create: { slug: s.slug, name: s.name, type: s.type },
    });

    const roleIds = new Map<RoleArchetype, string>();
    for (const r of BASE_ROLES) {
      const role = await prisma.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: r.name } },
        update: { description: r.description, archetype: r.archetype, isSystem: true },
        create: { tenantId: tenant.id, name: r.name, description: r.description, archetype: r.archetype, isSystem: true },
      });
      roleIds.set(r.archetype, role.id);
    }

    await grant(tenant.id, roleIds.get('admin')!, Object.keys(PERMISSIONS), permissionIds);
    await grant(tenant.id, roleIds.get('staff')!, TEACHER_PERMISSIONS, permissionIds);

    if (s.slug === 'northfield') {
      const examOfficer = await prisma.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: 'Exam Officer' } },
        update: {},
        create: {
          tenantId: tenant.id,
          name: 'Exam Officer',
          description: 'Validates and locks marks, approves changes to locked marks, publishes results.',
        },
      });
      await grant(tenant.id, examOfficer.id, EXAM_OFFICER_PERMISSIONS, permissionIds);
    }

    const admin = await upsertUser({
      tenantId: tenant.id,
      email: s.adminEmail,
      firstName: s.adminFirst,
      lastName: s.adminLast,
      passwordHash,
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.user.id, roleId: roleIds.get('admin')! } },
      update: {},
      create: { userId: admin.user.id, roleId: roleIds.get('admin')!, tenantId: tenant.id },
    });
    if (admin.created) createdAccounts.push(`${s.adminEmail}  (Administrator, ${s.slug})`);

    // Module Registry: switch on the demo modules (only creates missing rows,
    // so a Super Admin's later changes are never overwritten).
    for (const moduleCode of ACTIVE_MODULES[s.slug] ?? []) {
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleCode: { tenantId: tenant.id, moduleCode } },
        update: {},
        create: { tenantId: tenant.id, moduleCode, active: true },
      });
    }

    if (s.slug === 'northfield') {
      await seedAcademic(tenant.id);
      await seedStaff(tenant.id);
      await seedTeaching(tenant.id);
      await seedAssessments(tenant.id);
      await seedStudents(tenant.id);
      await seedMarks(tenant.id);
      await seedReadyClass(tenant.id);

      // A teacher account for Ngwa Brenda, linked to her staff record if that record has no account yet.
      const t = DEMO_TEACHER_ACCOUNT;
      const teacher = await upsertUser({ tenantId: tenant.id, email: t.email, firstName: t.firstName, lastName: t.lastName, passwordHash });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: teacher.user.id, roleId: roleIds.get('staff')! } },
        update: {},
        create: { userId: teacher.user.id, roleId: roleIds.get('staff')!, tenantId: tenant.id },
      });
      const linked = await prisma.staffMember.findFirst({ where: { userId: teacher.user.id }, select: { id: true } });
      if (!linked) {
        await prisma.staffMember.updateMany({
          where: { tenantId: tenant.id, staffNumber: t.staffNumber, userId: null },
          data: { userId: teacher.user.id },
        });
      }
      if (teacher.created) createdAccounts.push(`${t.email}  (Staff / Teacher, northfield)`);
    }
  }

  // 5. Audit
  await prisma.auditLog.create({
    data: { action: 'seed.run', detail: { schools: SCHOOLS.map((s) => s.slug) } },
  });

  // 6. Report
  console.log(`\nSeed complete: ${MODULES.length} modules, ${Object.keys(PERMISSIONS).length} permissions, ${SCHOOLS.length} schools.`);
  if (createdAccounts.length > 0) {
    console.log('\nNew accounts (must change password at first sign-in):');
    for (const a of createdAccounts) console.log(`  - ${a}`);
    if (!process.env.SEED_DEFAULT_PASSWORD) {
      console.log(`\nGenerated password for these accounts: ${password}`);
      console.log('It is shown only now. Store it safely, or set SEED_DEFAULT_PASSWORD in .env and re-create the accounts.');
    }
  } else {
    console.log('No new accounts created (they already exist).');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
