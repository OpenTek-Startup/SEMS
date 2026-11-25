import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthContext } from '../../core/auth/auth.types';
import { currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { assembleClasses, type ClassView } from '../academic/academic-rules';
import type { SetAssignmentDto } from './dto/teaching.dto';
import {
  type AssignmentGrid,
  buildGrid,
  checkSubjectInClass,
  checkTeacher,
  classesOf,
  type MyClass,
  type Problem,
  type TeacherOption,
  type TeacherRef,
  teacherOptions,
  toTeacherRef,
} from './teaching-rules';

const TEACHER_SELECT = {
  id: true,
  staffNumber: true,
  firstName: true,
  lastName: true,
  position: true,
  category: true,
  status: true,
} satisfies Prisma.StaffMemberSelect;

const ASSIGNMENT_SELECT = { id: true, sectionId: true, subjectId: true, staffMemberId: true } satisfies Prisma.TeacherAssignmentSelect;

/** The result of setting or clearing one cell. */
export interface AssignmentChange {
  yearId: string;
  sectionId: string;
  subjectId: string;
  teacher: TeacherRef | null;
}

/** What the signed-in teacher teaches this year. */
export interface MyTeaching {
  year: { id: string; name: string } | null;
  /** the staff record linked to this account, if any */
  staff: TeacherRef | null;
  classes: MyClass[];
}

type Status = 400 | 404 | 409;

function fail(status: Status, problem: Problem): HttpException {
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

/** "sectionId|subjectId", the key of one teaching cell. */
export function cellKey(sectionId: string, subjectId: string): string {
  return `${sectionId}|${subjectId}`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Teacher assignment (needs the Academic and Staff modules): which teacher
 * teaches which subject to which section, per school year. Attendance and
 * Assessment rely on it to show teachers only their own classes.
 *
 * Everything goes through the school-scoped client: an id from another
 * school is "not found".
 */
@Injectable()
export class TeachingService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  // ------------------------------------------------------------- reads

  /** Every section with its subjects and their teachers, for one year (default: current). */
  async grid(yearId?: string): Promise<AssignmentGrid> {
    this.requireSchool();
    const year = await this.resolveYear(yearId, false);
    const [classes, teachers, assignments] = await Promise.all([
      this.classes(),
      this.db.staffMember.findMany({ select: TEACHER_SELECT }),
      year ? this.db.teacherAssignment.findMany({ where: { academicYearId: year.id }, select: ASSIGNMENT_SELECT }) : [],
    ]);
    return buildGrid(year, classes, assignments, teachers);
  }

  /** Active teaching staff, with how many classes each has in the year. */
  async teachers(yearId?: string): Promise<TeacherOption[]> {
    this.requireSchool();
    const year = await this.resolveYear(yearId, false);
    const [teachers, assignments] = await Promise.all([
      this.db.staffMember.findMany({ where: { status: 'active', category: 'teaching' }, select: TEACHER_SELECT }),
      year ? this.db.teacherAssignment.findMany({ where: { academicYearId: year.id }, select: ASSIGNMENT_SELECT }) : [],
    ]);
    return teacherOptions(teachers, assignments);
  }

  /** The signed-in user's classes, through the staff record linked to their account. */
  async mine(actor: AuthContext): Promise<MyTeaching> {
    this.requireSchool();
    const year = await this.resolveYear(undefined, false);
    const staff = await this.db.staffMember.findFirst({ where: { userId: actor.userId }, select: TEACHER_SELECT });
    if (!staff || !year) return { year, staff: staff ? toTeacherRef(staff) : null, classes: [] };
    const [classes, assignments] = await Promise.all([
      this.classes(),
      this.db.teacherAssignment.findMany({
        where: { academicYearId: year.id, staffMemberId: staff.id },
        select: ASSIGNMENT_SELECT,
      }),
    ]);
    return { year, staff: toTeacherRef(staff), classes: classesOf(staff.id, classes, assignments) };
  }

  /**
   * The (section, subject) pairs the user teaches in a year, as "sectionId|subjectId"
   * keys, through the staff record linked to their account. Used by Assessment
   * (and later Attendance) so teachers only work on their own classes.
   */
  async cellsOf(userId: string, yearId: string): Promise<Set<string>> {
    const staff = await this.db.staffMember.findFirst({ where: { userId, status: 'active' }, select: { id: true } });
    if (!staff) return new Set();
    const rows = await this.db.teacherAssignment.findMany({
      where: { academicYearId: yearId, staffMemberId: staff.id },
      select: { sectionId: true, subjectId: true },
    });
    return new Set(rows.map((r) => cellKey(r.sectionId, r.subjectId)));
  }

  // ------------------------------------------------------------ writes

  /** Sets the teacher of one subject in one section, or clears it (staffMemberId null). */
  async set(actor: AuthContext, dto: SetAssignmentDto, ip: string | null): Promise<AssignmentChange> {
    const tenantId = this.requireSchool();
    const year = (await this.resolveYear(dto.yearId, true))!;

    const section = await this.db.section.findFirst({ where: { id: dto.sectionId }, select: { id: true, classId: true, name: true } });
    if (!section) throw fail(404, { code: 'SECTION_NOT_FOUND', message: 'This section does not exist in your school.' });
    const schoolClass = (await this.classes()).find((c) => c.id === section.classId);
    if (!schoolClass) throw fail(404, { code: 'CLASS_NOT_FOUND', message: 'This class does not exist in your school.' });
    const subjectProblem = checkSubjectInClass(schoolClass, dto.subjectId);
    if (subjectProblem) throw fail(400, subjectProblem);
    const subject = schoolClass.subjects.find((s) => s.subjectId === dto.subjectId)!;
    const label = `${schoolClass.name} ${section.name}`;

    const cell = { academicYearId: year.id, sectionId: section.id, subjectId: dto.subjectId };
    const existing = await this.db.teacherAssignment.findFirst({ where: cell, select: ASSIGNMENT_SELECT });

    if (dto.staffMemberId === null) {
      if (existing) {
        await this.db.teacherAssignment.delete({ where: { id: existing.id } });
        await this.log(actor, 'teaching.assignment.removed', existing.id, {
          year: year.name,
          section: label,
          subject: subject.code,
          staffMemberId: existing.staffMemberId,
        }, ip);
      }
      return { yearId: year.id, sectionId: section.id, subjectId: dto.subjectId, teacher: null };
    }

    const teacher = await this.db.staffMember.findFirst({ where: { id: dto.staffMemberId }, select: TEACHER_SELECT });
    if (!teacher) throw fail(404, { code: 'STAFF_NOT_FOUND', message: 'This staff member does not exist in your school.' });
    const teacherProblem = checkTeacher(teacher);
    if (teacherProblem) throw fail(400, teacherProblem);
    const ref = toTeacherRef(teacher);
    if (existing?.staffMemberId === teacher.id) {
      return { yearId: year.id, sectionId: section.id, subjectId: dto.subjectId, teacher: ref };
    }

    let id: string;
    try {
      if (existing) {
        await this.db.teacherAssignment.update({ where: { id: existing.id }, data: { staffMemberId: teacher.id } });
        id = existing.id;
      } else {
        const created = await this.db.teacherAssignment.create({
          data: { tenantId, ...cell, staffMemberId: teacher.id },
          select: { id: true },
        });
        id = created.id;
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw fail(409, {
          code: 'ASSIGNMENT_CHANGED',
          message: 'Someone else just assigned a teacher here. Refresh and try again.',
        });
      }
      throw err;
    }

    await this.log(actor, existing ? 'teaching.assignment.changed' : 'teaching.assignment.created', id, {
      year: year.name,
      section: label,
      subject: subject.code,
      staffMemberId: teacher.id,
      teacher: ref.fullName,
      ...(existing ? { previousStaffMemberId: existing.staffMemberId } : {}),
    }, ip);
    return { yearId: year.id, sectionId: section.id, subjectId: dto.subjectId, teacher: ref };
  }

  // ----------------------------------------------------------- helpers

  private async classes(): Promise<ClassView[]> {
    const [classes, sections, classSubjects, subjects] = await Promise.all([
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
      this.db.classSubject.findMany({ select: { classId: true, subjectId: true, coefficient: true } }),
      this.db.subject.findMany({ select: { id: true, code: true, name: true } }),
    ]);
    return assembleClasses(classes, sections, classSubjects, subjects);
  }

  /**
   * The year asked for, or the current year when none is given.
   * required: a write needs a year, so "no current year" is an error.
   */
  private async resolveYear(yearId: string | undefined, required: boolean): Promise<{ id: string; name: string } | null> {
    if (yearId) {
      const year = await this.db.academicYear.findFirst({ where: { id: yearId }, select: { id: true, name: true } });
      if (!year) throw fail(404, { code: 'YEAR_NOT_FOUND', message: 'This academic year does not exist in your school.' });
      return { id: year.id, name: year.name };
    }
    const current = await this.db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    if (!current && required) {
      throw fail(400, {
        code: 'YEAR_REQUIRED',
        message: 'There is no current academic year. Choose a year or make one current first.',
      });
    }
    return current ? { id: current.id, name: current.name } : null;
  }

  private log(
    actor: AuthContext,
    action: string,
    entityId: string,
    detail: Prisma.InputJsonObject,
    ipAddress: string | null,
  ): Promise<void> {
    return this.audit.record({
      action,
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      entity: 'teacher_assignment',
      entityId,
      detail,
      ipAddress,
    });
  }

  private requireSchool(): string {
    const tenantId = currentTenantId();
    if (!tenantId) throw fail(400, { code: 'SCHOOL_REQUIRED', message: 'This action needs a school.' });
    return tenantId;
  }
}
