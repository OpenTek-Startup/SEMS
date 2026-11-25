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
import { cleanName, parseDay, toSectionList, today } from '../academic/academic-rules';
import type { EnrollDto, EnrollmentQueryDto, TransferDto, WithdrawDto } from './dto/enrollment.dto';
import {
  checkCapacity,
  checkInYear,
  checkNotBefore,
  countBySection,
  defaultDay,
  duplicateIds,
  type EnrollmentRow,
  type EnrollmentView,
  type Problem,
  type RosterStudent,
  type SectionCount,
  sortEnrollments,
  toEnrollmentView,
  toRoster,
  type YearRange,
} from './enrollment-rules';

const ENROLLMENT_SELECT = {
  id: true,
  academicYearId: true,
  studentId: true,
  sectionId: true,
  status: true,
  enrolledOn: true,
  leftOn: true,
  reason: true,
} satisfies Prisma.EnrollmentSelect;

const STUDENT_SELECT = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  gender: true,
  status: true,
} satisfies Prisma.StudentSelect;

type Year = YearRange & { id: string };
type SectionInfo = { id: string; classId: string; label: string; capacity: number | null };

/** A student of a section's class list, as Assessment and Attendance use it. */
export type RosterEntry = RosterStudent & { fullName: string };

type Status = 400 | 404 | 409;

function fail(status: Status, problem: Problem): HttpException {
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

const nameOf = (s: { lastName: string; firstName: string }) => `${s.lastName} ${s.firstName}`;

/** "Abena Ada, Bih Clarisse and 3 others" */
function names(list: readonly string[]): string {
  if (list.length <= 3) return list.join(', ');
  return `${list.slice(0, 3).join(', ')} and ${list.length - 3} others`;
}

/**
 * Enrollment (module "enrollment"): which student is in which section in a
 * school year, transfers between sections and withdrawals. Closed
 * enrollments stay as history. rosterOf() gives other modules the class
 * list of a section.
 */
@Injectable()
export class EnrollmentService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  // ------------------------------------------------------------- reads

  async list(query: EnrollmentQueryDto): Promise<EnrollmentView[]> {
    this.requireSchool();
    const year = await this.resolveYear(query.yearId, false);
    if (!year) return [];
    const where: Prisma.EnrollmentWhereInput = { academicYearId: year.id };
    if (query.sectionId) where.sectionId = query.sectionId;
    if (query.status) where.status = query.status;
    const rows = await this.db.enrollment.findMany({ where, select: ENROLLMENT_SELECT });
    return this.views(rows);
  }

  /** Every section of the school with its number of students in the year. */
  async sections(yearId?: string): Promise<{ year: { id: string; name: string } | null; sections: SectionCount[] }> {
    this.requireSchool();
    const year = await this.resolveYear(yearId, false);
    const sections = await this.sectionList();
    if (!year) return { year: null, sections: countBySection(sections, []) };
    const active = await this.db.enrollment.findMany({
      where: { academicYearId: year.id, status: 'active' },
      select: { sectionId: true, studentId: true },
    });
    const students = await this.studentsById(active.map((a) => a.studentId));
    return {
      year: { id: year.id, name: year.name },
      sections: countBySection(
        sections,
        active.map((a) => ({ sectionId: a.sectionId, gender: students.get(a.studentId)?.gender ?? '' })),
      ),
    };
  }

  /**
   * The class list of a section: its active students, sorted by name.
   * For Assessment (mark sheets) and Attendance (registers).
   */
  async rosterOf(sectionId: string, yearId: string): Promise<RosterEntry[]> {
    const rows = await this.db.enrollment.findMany({
      where: { sectionId, academicYearId: yearId, status: 'active' },
      select: { studentId: true },
    });
    const students = await this.studentsById(rows.map((r) => r.studentId));
    return toRoster([...students.values()]);
  }

  // ------------------------------------------------------------ writes

  async enroll(actor: AuthContext, dto: EnrollDto, ip: string | null): Promise<EnrollmentView[]> {
    const tenantId = this.requireSchool();
    const year = (await this.resolveYear(dto.yearId, true))!;
    const section = await this.findSection(dto.sectionId);

    const dup = duplicateIds(dto.studentIds);
    if (dup.length > 0) throw fail(400, { code: 'DUPLICATE_STUDENT', message: 'A student appears twice in the list.', students: dup });
    const students = await this.db.student.findMany({ where: { id: { in: dto.studentIds } }, select: STUDENT_SELECT });
    if (students.length !== dto.studentIds.length) {
      throw fail(404, { code: 'STUDENT_NOT_FOUND', message: 'One or more students do not exist in your school.' });
    }
    const inactive = students.filter((s) => s.status !== 'active');
    if (inactive.length > 0) {
      throw fail(400, {
        code: 'STUDENT_INACTIVE',
        message: `${names(inactive.map(nameOf))} ${inactive.length === 1 ? 'has' : 'have'} left the school. Reactivate them first.`,
        students: inactive.map((s) => s.id),
      });
    }

    const day = this.day(dto.enrolledOn, year);
    const created: EnrollmentRow[] = [];
    await this.db.$transaction(async (tx) => {
      const already = await tx.enrollment.findMany({
        where: { academicYearId: year.id, status: 'active', studentId: { in: dto.studentIds } },
        select: { studentId: true, sectionId: true },
      });
      if (already.length > 0) {
        const byId = new Map(students.map((s) => [s.id, s]));
        throw fail(409, {
          code: 'ALREADY_ENROLLED',
          message: `${names(already.map((a) => nameOf(byId.get(a.studentId)!)))} already ${already.length === 1 ? 'has' : 'have'} a class in ${year.name}. Transfer them instead.`,
          students: already.map((a) => a.studentId),
        });
      }
      const current = await tx.enrollment.count({ where: { academicYearId: year.id, sectionId: section.id, status: 'active' } });
      const full = checkCapacity(section.label, section.capacity, current, students.length);
      if (full) throw fail(409, full);
      for (const s of students) {
        created.push(
          await tx.enrollment.create({
            data: { tenantId, academicYearId: year.id, studentId: s.id, sectionId: section.id, enrolledOn: day },
            select: ENROLLMENT_SELECT,
          }),
        );
      }
    });

    const byId = new Map(students.map((s) => [s.id, s]));
    for (const e of created) {
      const s = byId.get(e.studentId)!;
      await this.log(actor, 'enrollment.created', e.id, { student: nameOf(s), matricule: s.matricule, section: section.label, year: year.name }, ip);
    }
    return this.views(created);
  }

  /** Moves a student to another section of the same year: the old row is kept as "transferred". */
  async transfer(actor: AuthContext, id: string, dto: TransferDto, ip: string | null): Promise<EnrollmentView> {
    const tenantId = this.requireSchool();
    const from = await this.findActive(id);
    const year = await this.findYear(from.academicYearId);
    const to = await this.findSection(dto.sectionId);
    if (to.id === from.sectionId) {
      throw fail(400, { code: 'SAME_SECTION', message: `The student is already in ${to.label}.` });
    }
    const day = this.day(dto.on, year);
    this.check(checkNotBefore(day, from.enrolledOn));
    const source = await this.findSection(from.sectionId);

    let created: EnrollmentRow | undefined;
    await this.db.$transaction(async (tx) => {
      const current = await tx.enrollment.count({ where: { academicYearId: year.id, sectionId: to.id, status: 'active' } });
      const full = checkCapacity(to.label, to.capacity, current, 1);
      if (full) throw fail(409, full);
      const closed = await tx.enrollment.updateMany({
        where: { id: from.id, status: 'active' },
        data: { status: 'transferred', leftOn: day, reason: `Transferred to ${to.label}` },
      });
      if (closed.count === 0) throw this.changed();
      created = await tx.enrollment.create({
        data: { tenantId, academicYearId: year.id, studentId: from.studentId, sectionId: to.id, enrolledOn: day },
        select: ENROLLMENT_SELECT,
      });
    });

    const student = await this.studentsById([from.studentId]);
    await this.log(actor, 'enrollment.transferred', created!.id, {
      student: nameOf(student.get(from.studentId)!),
      from: source.label,
      to: to.label,
      year: year.name,
      previousEnrollmentId: from.id,
    }, ip);
    return (await this.views([created!]))[0];
  }

  /** The student leaves the class (and usually the school) during the year. */
  async withdraw(actor: AuthContext, id: string, dto: WithdrawDto, ip: string | null): Promise<EnrollmentView> {
    this.requireSchool();
    const row = await this.findActive(id);
    const year = await this.findYear(row.academicYearId);
    const day = this.day(dto.on, year);
    this.check(checkNotBefore(day, row.enrolledOn));
    const reason = dto.reason !== undefined && cleanName(dto.reason) !== '' ? cleanName(dto.reason) : null;

    const closed = await this.db.enrollment.updateMany({
      where: { id, status: 'active' },
      data: { status: 'withdrawn', leftOn: day, reason },
    });
    if (closed.count === 0) throw this.changed();
    const [student, section] = await Promise.all([this.studentsById([row.studentId]), this.findSection(row.sectionId)]);
    await this.log(actor, 'enrollment.withdrawn', id, {
      student: nameOf(student.get(row.studentId)!),
      section: section.label,
      year: year.name,
      reason,
    }, ip);
    const updated = await this.db.enrollment.findFirst({ where: { id }, select: ENROLLMENT_SELECT });
    return (await this.views([updated!]))[0];
  }

  // ----------------------------------------------------------- helpers

  private async views(rows: readonly EnrollmentRow[]): Promise<EnrollmentView[]> {
    const [students, sections] = await Promise.all([
      this.studentsById(rows.map((r) => r.studentId)),
      this.sectionList(),
    ]);
    const labels = new Map(sections.map((s) => [s.id, s.label]));
    return sortEnrollments(rows.map((r) => toEnrollmentView(r, students, labels)));
  }

  private async studentsById(ids: readonly string[]): Promise<Map<string, RosterStudent>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db.student.findMany({ where: { id: { in: unique } }, select: STUDENT_SELECT });
    return new Map(
      rows.map((s) => [
        s.id,
        { studentId: s.id, matricule: s.matricule, firstName: s.firstName, lastName: s.lastName, gender: s.gender },
      ]),
    );
  }

  private async sectionList(): Promise<SectionInfo[]> {
    const [classes, sections] = await Promise.all([
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
    ]);
    return toSectionList(classes, sections).map((s) => ({ id: s.id, classId: s.classId, label: s.label, capacity: s.capacity }));
  }

  private async findSection(id: string): Promise<SectionInfo> {
    const section = (await this.sectionList()).find((s) => s.id === id);
    if (!section) throw fail(404, { code: 'SECTION_NOT_FOUND', message: 'This section does not exist in your school.' });
    return section;
  }

  private async findActive(id: string): Promise<EnrollmentRow> {
    const row = await this.db.enrollment.findFirst({ where: { id }, select: ENROLLMENT_SELECT });
    if (!row) throw fail(404, { code: 'ENROLLMENT_NOT_FOUND', message: 'This enrollment does not exist in your school.' });
    if (row.status !== 'active') {
      throw fail(409, {
        code: 'ENROLLMENT_CLOSED',
        message: `This enrollment is already closed (${row.status}). Use the student's current class.`,
      });
    }
    return row;
  }

  private async findYear(id: string): Promise<Year> {
    const year = await this.db.academicYear.findFirst({ where: { id }, select: { id: true, name: true, startDate: true, endDate: true } });
    if (!year) throw fail(404, { code: 'YEAR_NOT_FOUND', message: 'This academic year does not exist in your school.' });
    return year;
  }

  /** The year asked for, or the current year. required: a write needs one. */
  private async resolveYear(yearId: string | undefined, required: boolean): Promise<Year | null> {
    if (yearId) return this.findYear(yearId);
    const current = await this.db.academicYear.findFirst({
      where: { isCurrent: true },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
    if (!current && required) {
      throw fail(400, {
        code: 'YEAR_REQUIRED',
        message: 'There is no current academic year. Choose a year or make one current first.',
      });
    }
    return current ?? null;
  }

  /** The day given (checked against the year), or today kept inside the year. */
  private day(value: string | undefined, year: Year): Date {
    if (value === undefined) return defaultDay(year, today());
    const d = parseDay(value);
    if (!d) throw fail(400, { code: 'DATE_INVALID', message: `${value} is not a real date.` });
    this.check(checkInYear(d, year));
    return d;
  }

  private check(problem: Problem | null): void {
    if (problem) throw fail(400, problem);
  }

  private changed(): HttpException {
    return fail(409, { code: 'ENROLLMENT_CHANGED', message: 'Someone else just changed this enrollment. Refresh and try again.' });
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
      entity: 'enrollment',
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
