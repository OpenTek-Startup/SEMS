/**
 * YESE development seed — safe to run many times (everything is upserted).
 *
 * Creates:
 *  - the module catalogue and the permission catalogue
 *  - one platform Super Admin
 *  - two demo schools (Northfield, Sunrise) from SRS v1.2 §3.3
 *  - the four base roles per school, plus an "Exam Officer" custom role at Northfield
 *  - one administrator account per school
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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// ------------------------------------------------------------ catalogues

const MODULES: { code: string; name: string; category: ModuleCategory; description: string }[] = [
  { code: 'core', name: 'Core platform', category: 'core', description: 'Tenancy, users, roles, settings, audit' },
  { code: 'student', name: 'Students', category: 'business', description: 'Student and guardian registry' },
  { code: 'staff', name: 'Staff', category: 'business', description: 'Teaching and non-teaching staff' },
  { code: 'academic', name: 'Academic structure', category: 'business', description: 'Years, terms, classes, subjects' },
  { code: 'enrollment', name: 'Enrollment', category: 'business', description: 'Students into sections per year' },
  { code: 'attendance', name: 'Attendance', category: 'business', description: 'Registers and attendance reports' },
  { code: 'assessment', name: 'Assessment', category: 'business', description: 'Assessments, marks, validation, locking' },
  { code: 'results', name: 'Results & report cards', category: 'business', description: 'Averages, ranks, report cards' },
  { code: 'finance', name: 'Finance', category: 'business', description: 'Fees, invoices, payments, receipts' },
  { code: 'comms', name: 'Communication', category: 'extension', description: 'Notifications, announcements, parent portal' },
];

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

const TEACHER_PERMISSIONS = [
  'student.record.view',
  'attendance.register.take',
  'attendance.report.view',
  'assessment.create',
  'assessment.marks.enter',
];

const EXAM_OFFICER_PERMISSIONS = [
  'student.record.view',
  'attendance.report.view',
  'assessment.marks.validate',
  'assessment.marks.lock',
  'assessment.marks.override',
  'results.compute',
  'results.reportcard.generate',
  'results.publish',
];

const BASE_ROLES: { archetype: RoleArchetype; name: string; description: string }[] = [
  { archetype: 'admin', name: 'Administrator', description: 'Full rights inside this school.' },
  { archetype: 'staff', name: 'Staff / Teacher', description: 'Registers and mark entry for assigned subjects and sections.' },
  { archetype: 'parent', name: 'Parent', description: 'Read-only access to linked children.' },
  { archetype: 'student', name: 'Student', description: 'Read-only access to own published results and attendance.' },
];

const SCHOOLS: { slug: string; name: string; type: InstitutionType; adminEmail: string; adminFirst: string; adminLast: string }[] = [
  { slug: 'northfield', name: 'Northfield Bilingual College', type: 'secondary', adminEmail: 'admin@northfield.school', adminFirst: 'M.', adminLast: 'Ndzana' },
  { slug: 'sunrise', name: 'Sunrise Comprehensive College', type: 'secondary', adminEmail: 'admin@sunrise.school', adminFirst: 'School', adminLast: 'Administrator' },
];

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

async function grant(tenantId: string, roleId: string, codes: string[], permissionIds: Map<string, string>) {
  await prisma.rolePermission.createMany({
    data: codes.map((code) => {
      const permissionId = permissionIds.get(code);
      if (!permissionId) throw new Error(`Unknown permission code: ${code}`);
      return { roleId, permissionId, tenantId };
    }),
    skipDuplicates: true,
  });
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
      update: { name: m.name, category: m.category, description: m.description },
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
