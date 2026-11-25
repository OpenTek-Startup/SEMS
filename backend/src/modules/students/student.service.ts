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
import { formatDay, parseDay, toSectionList, today } from '../academic/academic-rules';
import type { CreateStudentDto, ListStudentsQueryDto, UpdateStudentDto } from './dto/student.dto';
import {
  changedFields,
  checkDateOfBirth,
  cleanText,
  type CurrentPlace,
  filterStudents,
  type Gender,
  nextMatricule,
  normalizeMatricule,
  normalizePhone,
  type Problem,
  type StudentRow,
  type StudentView,
  toStudentView,
} from './student-rules';

const STUDENT_SELECT = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  placeOfBirth: true,
  guardianName: true,
  guardianPhone: true,
  guardianRelationship: true,
  status: true,
  admittedOn: true,
} satisfies Prisma.StudentSelect;

/** One line of a student's enrollment history. */
export interface EnrollmentLine {
  id: string;
  year: { id: string; name: string };
  section: { id: string; label: string };
  status: string;
  enrolledOn: string;
  leftOn: string | null;
  reason: string | null;
}

export interface StudentDetail extends StudentView {
  enrollments: EnrollmentLine[];
}

type Status = 400 | 404 | 409;

function fail(status: Status, problem: Problem): HttpException {
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/** The editable fields of a student, after cleaning. */
interface StudentFields {
  matricule: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: Date | null;
  placeOfBirth: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelationship: string | null;
  admittedOn: Date | null;
}

/**
 * Student records of a school (module "student"). Students are never
 * deleted: a student who leaves becomes inactive, so enrollments, marks
 * and registers keep pointing at them. Classes are handled by Enrollment.
 */
@Injectable()
export class StudentService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  // ------------------------------------------------------------- reads

  async list(query: ListStudentsQueryDto): Promise<StudentView[]> {
    this.requireSchool();
    const [rows, places] = await Promise.all([
      this.db.student.findMany({ select: STUDENT_SELECT }),
      this.currentPlaces(),
    ]);
    return filterStudents(
      rows.map((r) => toStudentView(r, places.get(r.id) ?? null)),
      {
        search: query.search,
        status: query.unplaced === 'true' ? 'active' : query.status,
        sectionId: query.sectionId,
        unplaced: query.unplaced === 'true',
      },
    );
  }

  async get(id: string): Promise<StudentDetail> {
    this.requireSchool();
    const row = await this.find(id);
    const [places, enrollments, years, classes, sections] = await Promise.all([
      this.currentPlaces(id),
      this.db.enrollment.findMany({
        where: { studentId: id },
        select: { id: true, academicYearId: true, sectionId: true, status: true, enrolledOn: true, leftOn: true, reason: true },
      }),
      this.db.academicYear.findMany({ select: { id: true, name: true, startDate: true } }),
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
    ]);
    const yearById = new Map(years.map((y) => [y.id, y]));
    const labelOf = new Map(toSectionList(classes, sections).map((s) => [s.id, s.label]));
    const history: EnrollmentLine[] = [...enrollments]
      .sort(
        (a, b) =>
          (yearById.get(b.academicYearId)?.startDate.getTime() ?? 0) - (yearById.get(a.academicYearId)?.startDate.getTime() ?? 0) ||
          b.enrolledOn.getTime() - a.enrolledOn.getTime(),
      )
      .map((e) => ({
        id: e.id,
        year: { id: e.academicYearId, name: yearById.get(e.academicYearId)?.name ?? '?' },
        section: { id: e.sectionId, label: labelOf.get(e.sectionId) ?? '?' },
        status: e.status,
        enrolledOn: formatDay(e.enrolledOn),
        leftOn: e.leftOn ? formatDay(e.leftOn) : null,
        reason: e.reason,
      }));
    return { ...toStudentView(row, places.get(id) ?? null), enrollments: history };
  }

  // ------------------------------------------------------------ writes

  async create(actor: AuthContext, dto: CreateStudentDto, ip: string | null): Promise<StudentDetail> {
    const tenantId = this.requireSchool();
    const generated = dto.matricule === undefined || dto.matricule.trim() === '';
    const fields: StudentFields = {
      matricule: generated ? '' : this.matricule(dto.matricule!),
      firstName: cleanText(dto.firstName),
      lastName: cleanText(dto.lastName),
      gender: dto.gender,
      dateOfBirth: this.dateOfBirth(dto.dateOfBirth),
      placeOfBirth: this.text(dto.placeOfBirth),
      guardianName: this.text(dto.guardianName),
      guardianPhone: this.phone(dto.guardianPhone),
      guardianRelationship: this.text(dto.guardianRelationship),
      admittedOn: this.day(dto.admittedOn, 'admittedOn'),
    };

    // A generated matricule can collide with someone saving at the same moment: try again once.
    let created: { id: string } | undefined;
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      const existing = await this.db.student.findMany({ select: { matricule: true } });
      if (generated) {
        fields.matricule = nextMatricule(existing.map((e) => e.matricule));
      } else if (existing.some((e) => e.matricule === fields.matricule)) {
        throw this.matriculeTaken(fields.matricule);
      }
      try {
        created = await this.db.student.create({ data: { tenantId, ...fields }, select: { id: true } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (!generated || attempt === 1) throw this.matriculeTaken(fields.matricule);
      }
    }

    await this.log(actor, 'student.created', created!.id, {
      matricule: fields.matricule,
      name: `${fields.lastName} ${fields.firstName}`,
    }, ip);
    return this.get(created!.id);
  }

  async update(actor: AuthContext, id: string, dto: UpdateStudentDto, ip: string | null): Promise<StudentDetail> {
    this.requireSchool();
    const row = await this.find(id);
    const before: StudentFields = {
      matricule: row.matricule,
      firstName: row.firstName,
      lastName: row.lastName,
      gender: row.gender as Gender,
      dateOfBirth: row.dateOfBirth,
      placeOfBirth: row.placeOfBirth,
      guardianName: row.guardianName,
      guardianPhone: row.guardianPhone,
      guardianRelationship: row.guardianRelationship,
      admittedOn: row.admittedOn,
    };
    const pick = <K extends keyof StudentFields>(key: K, value: StudentFields[K] | undefined): StudentFields[K] =>
      value === undefined ? before[key] : value;
    const after: StudentFields = {
      matricule: pick('matricule', dto.matricule !== undefined ? this.matricule(dto.matricule) : undefined),
      firstName: pick('firstName', dto.firstName !== undefined ? cleanText(dto.firstName) : undefined),
      lastName: pick('lastName', dto.lastName !== undefined ? cleanText(dto.lastName) : undefined),
      gender: pick('gender', dto.gender),
      dateOfBirth: pick('dateOfBirth', dto.dateOfBirth !== undefined ? this.dateOfBirth(dto.dateOfBirth) : undefined),
      placeOfBirth: pick('placeOfBirth', dto.placeOfBirth !== undefined ? this.text(dto.placeOfBirth) : undefined),
      guardianName: pick('guardianName', dto.guardianName !== undefined ? this.text(dto.guardianName) : undefined),
      guardianPhone: pick('guardianPhone', dto.guardianPhone !== undefined ? this.phone(dto.guardianPhone) : undefined),
      guardianRelationship: pick(
        'guardianRelationship',
        dto.guardianRelationship !== undefined ? this.text(dto.guardianRelationship) : undefined,
      ),
      admittedOn: pick('admittedOn', dto.admittedOn !== undefined ? this.day(dto.admittedOn, 'admittedOn') : undefined),
    };

    const changed = changedFields(before, after);
    if (changed.length === 0) return this.get(id);
    if (after.matricule !== before.matricule) {
      const clash = await this.db.student.findFirst({ where: { matricule: after.matricule, id: { not: id } }, select: { id: true } });
      if (clash) throw this.matriculeTaken(after.matricule);
    }
    try {
      await this.db.student.update({ where: { id }, data: after });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.matriculeTaken(after.matricule);
      throw err;
    }
    await this.log(actor, 'student.updated', id, { matricule: after.matricule, changed }, ip);
    return this.get(id);
  }

  /** inactive: the student has left the school. Withdraw them from their class first. */
  async setStatus(actor: AuthContext, id: string, status: 'active' | 'inactive', ip: string | null): Promise<StudentDetail> {
    this.requireSchool();
    const row = await this.find(id);
    if (row.status === status) return this.get(id);
    if (status === 'inactive') {
      const enrolled = await this.db.enrollment.count({ where: { studentId: id, status: 'active' } });
      if (enrolled > 0) {
        throw fail(409, {
          code: 'STUDENT_ENROLLED',
          message: `${row.lastName} ${row.firstName} is still in a class. Withdraw them in Enrollment first.`,
        });
      }
    }
    await this.db.student.update({ where: { id }, data: { status } });
    await this.log(actor, status === 'inactive' ? 'student.deactivated' : 'student.reactivated', id, { matricule: row.matricule }, ip);
    return this.get(id);
  }

  // ----------------------------------------------------------- helpers

  /** studentId -> where the student is in the current year (active enrollments only). */
  private async currentPlaces(studentId?: string): Promise<Map<string, CurrentPlace>> {
    const year = await this.db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) return new Map();
    const where: Prisma.EnrollmentWhereInput = { academicYearId: year.id, status: 'active' };
    if (studentId) where.studentId = studentId;
    const [enrollments, classes, sections] = await Promise.all([
      this.db.enrollment.findMany({ where, select: { id: true, studentId: true, sectionId: true } }),
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
    ]);
    const labelOf = new Map(toSectionList(classes, sections).map((s) => [s.id, s.label]));
    return new Map(
      enrollments.map((e) => [
        e.studentId,
        { enrollmentId: e.id, yearId: year.id, sectionId: e.sectionId, label: labelOf.get(e.sectionId) ?? '?' },
      ]),
    );
  }

  private async find(id: string): Promise<StudentRow> {
    const row = await this.db.student.findFirst({ where: { id }, select: STUDENT_SELECT });
    if (!row) throw fail(404, { code: 'STUDENT_NOT_FOUND', message: 'This student does not exist in your school.' });
    return row;
  }

  private matricule(value: string): string {
    const m = normalizeMatricule(value);
    if (!m) {
      throw fail(400, {
        code: 'MATRICULE_INVALID',
        message: 'A matricule has 2 to 20 letters, digits, "-" or "/", e.g. STU-0042.',
      });
    }
    return m;
  }

  private text(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const v = cleanText(value);
    return v === '' ? null : v;
  }

  private phone(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    const p = normalizePhone(value);
    if (!p) throw fail(400, { code: 'PHONE_INVALID', message: 'Enter a phone number with 8 to 15 digits, e.g. +237 677 12 34 56.' });
    return p;
  }

  private day(value: string | null | undefined, field: string): Date | null {
    if (value === undefined || value === null) return null;
    const d = parseDay(value);
    if (!d) throw fail(400, { code: 'DATE_INVALID', message: `${field}: ${value} is not a real date.` });
    return d;
  }

  private dateOfBirth(value: string | null | undefined): Date | null {
    const d = this.day(value, 'dateOfBirth');
    if (d) {
      const problem = checkDateOfBirth(d, today());
      if (problem) throw fail(400, problem);
    }
    return d;
  }

  private matriculeTaken(matricule: string) {
    return fail(409, { code: 'MATRICULE_TAKEN', message: `Matricule ${matricule} is already used in your school.` });
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
      entity: 'student',
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
