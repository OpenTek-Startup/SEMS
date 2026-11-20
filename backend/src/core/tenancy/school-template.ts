/**
 * What every new school starts with: the four base roles (two-layer RBAC,
 * FR-ID-04) and the permissions of the Staff / Teacher role.
 *
 * Shared by the seed and by the Super Admin "create school" action, so a
 * school made in the console looks exactly like a seeded one.
 * The Administrator role always receives the whole permission catalogue.
 */
import type { RoleArchetype } from '../../generated/prisma/enums';

export interface BaseRoleTemplate {
  archetype: RoleArchetype;
  name: string;
  description: string;
}

export const BASE_ROLES: readonly BaseRoleTemplate[] = [
  { archetype: 'admin', name: 'Administrator', description: 'Full rights inside this school.' },
  { archetype: 'staff', name: 'Staff / Teacher', description: 'Registers and mark entry for assigned subjects and sections.' },
  { archetype: 'parent', name: 'Parent', description: 'Read-only access to linked children.' },
  { archetype: 'student', name: 'Student', description: 'Read-only access to own published results and attendance.' },
];

export const TEACHER_PERMISSIONS: readonly string[] = [
  'student.record.view',
  'staff.record.view',
  'academic.structure.view',
  'attendance.register.take',
  'attendance.report.view',
  'assessment.create',
  'assessment.marks.enter',
];
