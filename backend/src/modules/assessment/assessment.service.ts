import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { AuthService } from '../../core/auth/auth.service';
import type { AuthContext } from '../../core/auth/auth.types';
import { currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { cleanName, nameTaken, parseDay, toSectionList } from '../academic/academic-rules';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { cellKey, TeachingService } from '../teaching/teaching.service';
import type { CreateAssessmentDto, ListAssessmentsQueryDto, SaveMarksDto, UpdateAssessmentDto } from './dto/assessment.dto';
import {
  buildSheet,
  checkComplete,
  checkMarksWritable,
  checkOverrideReason,
  diffMarks,
  isProblem,
  type MarkValue,
  parseMark,
  type SheetLine,
  type SheetSummary,
  type StoredMark,
  summarize,
} from './marks-rules';
import {
  type AssessmentAction,
  type AssessmentRow,
  type AssessmentStatus,
  type AssessmentView,
  checkEditable,
  checkHeldOn,
  checkScoring,
  type Lookups,
  nextStatus,
  type Problem,
  sortAssessments,
  toAssessmentView,
} from './assessment-rules';

const ASSESSMENT_SELECT = {
  id: true,
  academicYearId: true,
  termId: true,
  sectionId: true,
  subjectId: true,
  name: true,
  maxScore: true,
  weight: true,
  heldOn: true,
  status: true,
  submittedAt: true,
  validatedAt: true,
  lockedAt: true,
  createdAt: true,
} satisfies Prisma.AssessmentSelect;

const MARK_SELECT = { id: true, studentId: true, score: true, absent: true } satisfies Prisma.MarkSelect;

/** The mark sheet of one assessment. */
export interface MarkSheet {
  assessment: AssessmentView;
  students: SheetLine[];
  summary: SheetSummary;
  /** open: the teacher can type; override: locked, changes need a reason; closed: waiting for validation */
  editing: 'open' | 'override' | 'closed';
}

const TERM_SELECT = { id: true, academicYearId: true, name: true, startDate: true, endDate: true } satisfies Prisma.TermSelect;

/** Holders of this permission (exam officer, administrator) work on every class. */
const ALL_CLASSES = 'assessment.marks.validate';

const ACTION_LOG: Record<AssessmentAction, string> = {
  submit: 'assessment.submitted',
  validate: 'assessment.validated',
  reopen: 'assessment.reopened',
  lock: 'assessment.locked',
};

type Status = 400 | 403 | 404 | 409;

function fail(status: Status, problem: Problem): HttpException {
  if (status === 403) return new ForbiddenException(problem);
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Assessments (module "assessment"): tests, sequences and exams of one
 * subject in one section, in one term, and their workflow
 * (open -> submitted -> validated -> locked).
 *
 * A teacher works only on the classes assigned to them (Teaching module).
 * Holders of assessment.marks.validate (exam officer, administrator) see
 * and manage every class. Marks come with Enrollment.
 */
@Injectable()
export class AssessmentService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly teaching: TeachingService,
    private readonly enrollment: EnrollmentService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  // ------------------------------------------------------------- reads

  /** Assessments of one year (default: current), narrowed by the filters and to the caller's classes. */
  async list(actor: AuthContext, query: ListAssessmentsQueryDto): Promise<AssessmentView[]> {
    this.requireSchool();
    const yearId = query.yearId ?? (await this.currentYearId());
    if (!yearId) return [];
    if (query.yearId) await this.findYear(query.yearId);

    const where: Prisma.AssessmentWhereInput = { academicYearId: yearId };
    if (query.termId) where.termId = query.termId;
    if (query.sectionId) where.sectionId = query.sectionId;
    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.status) where.status = query.status;

    const [rows, scope, lookups] = await Promise.all([
      this.db.assessment.findMany({ where, select: ASSESSMENT_SELECT }),
      this.scope(actor, yearId),
      this.lookups(),
    ]);
    const visible = scope ? rows.filter((r) => scope.has(cellKey(r.sectionId, r.subjectId))) : rows;
    return sortAssessments(visible, lookups).map((r) => toAssessmentView(r, lookups));
  }

  async get(actor: AuthContext, id: string): Promise<AssessmentView> {
    this.requireSchool();
    const row = await this.find(id);
    await this.assertOwnClass(actor, row);
    return this.view(row);
  }

  // ------------------------------------------------------------ writes

  async create(actor: AuthContext, dto: CreateAssessmentDto, ip: string | null): Promise<AssessmentView> {
    const tenantId = this.requireSchool();
    const term = await this.db.term.findFirst({ where: { id: dto.termId }, select: TERM_SELECT });
    if (!term) throw fail(404, { code: 'TERM_NOT_FOUND', message: 'This term does not exist in your school.' });
    const place = await this.place(dto.sectionId, dto.subjectId);
    await this.assertOwnClass(actor, { academicYearId: term.academicYearId, ...dto });

    const name = cleanName(dto.name);
    const maxScore = dto.maxScore ?? 20;
    const weight = dto.weight ?? 1;
    this.check(checkScoring(maxScore, weight));
    const heldOn = this.heldOn(dto.heldOn, term);
    await this.assertNameFree(name, dto.termId, dto.sectionId, dto.subjectId);

    let created: AssessmentRow;
    try {
      created = await this.db.assessment.create({
        data: {
          tenantId,
          academicYearId: term.academicYearId,
          termId: term.id,
          sectionId: dto.sectionId,
          subjectId: dto.subjectId,
          name,
          maxScore,
          weight,
          heldOn,
        },
        select: ASSESSMENT_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.nameTakenError(name);
      throw err;
    }
    await this.log(actor, 'assessment.created', created.id, {
      name,
      term: term.name,
      section: place.label,
      subject: place.code,
      maxScore,
      weight,
    }, ip);
    return this.view(created);
  }

  async update(actor: AuthContext, id: string, dto: UpdateAssessmentDto, ip: string | null): Promise<AssessmentView> {
    this.requireSchool();
    const row = await this.find(id);
    await this.assertOwnClass(actor, row);
    this.assertEditable(row);
    const term = (await this.db.term.findFirst({ where: { id: row.termId }, select: TERM_SELECT }))!;

    const name = dto.name !== undefined ? cleanName(dto.name) : row.name;
    const maxScore = dto.maxScore ?? row.maxScore;
    const weight = dto.weight ?? row.weight;
    this.check(checkScoring(maxScore, weight));
    const heldOn = dto.heldOn !== undefined ? this.heldOn(dto.heldOn, term) : row.heldOn;

    const changed: string[] = [];
    if (name !== row.name) changed.push('name');
    if (maxScore !== row.maxScore) changed.push('maxScore');
    if (weight !== row.weight) changed.push('weight');
    if ((heldOn?.getTime() ?? null) !== (row.heldOn?.getTime() ?? null)) changed.push('heldOn');
    if (changed.length === 0) return this.view(row);

    if (changed.includes('name')) await this.assertNameFree(name, row.termId, row.sectionId, row.subjectId, id);
    let updated: AssessmentRow;
    try {
      updated = await this.db.assessment.update({
        where: { id },
        data: { name, maxScore, weight, heldOn },
        select: ASSESSMENT_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.nameTakenError(name);
      throw err;
    }
    await this.log(actor, 'assessment.updated', id, { name, changed }, ip);
    return this.view(updated);
  }

  async remove(actor: AuthContext, id: string, ip: string | null): Promise<{ id: string; deleted: true }> {
    this.requireSchool();
    const row = await this.find(id);
    await this.assertOwnClass(actor, row);
    this.assertEditable(row);
    const place = await this.place(row.sectionId, row.subjectId);
    await this.db.$transaction(async (tx) => {
      await tx.mark.deleteMany({ where: { assessmentId: id } });
      await tx.assessment.delete({ where: { id } });
    });
    await this.log(actor, 'assessment.deleted', id, { name: row.name, section: place.label, subject: place.code }, ip);
    return { id, deleted: true };
  }

  /**
   * One workflow step. The controller checks the permission of each step;
   * submitting is also limited to the teacher of the class.
   */
  async transition(actor: AuthContext, id: string, action: AssessmentAction, ip: string | null): Promise<AssessmentView> {
    this.requireSchool();
    const row = await this.find(id);
    if (action === 'submit') await this.assertOwnClass(actor, row);
    const next = nextStatus(row.status as AssessmentStatus, action);
    if (typeof next !== 'string') throw fail(409, next);
    if (action === 'submit') {
      // Every student of the section needs a mark or "absent" first.
      const [roster, marks] = await Promise.all([
        this.enrollment.rosterOf(row.sectionId, row.academicYearId),
        this.storedMarks(row.id),
      ]);
      const incomplete = checkComplete(
        roster.map((r) => r.studentId),
        new Map(marks.map((m) => [m.studentId, m])),
      );
      if (incomplete) throw fail(409, incomplete);
    }

    const now = new Date();
    const data: Prisma.AssessmentUpdateManyMutationInput = { status: next };
    if (action === 'submit') data.submittedAt = now;
    if (action === 'validate') data.validatedAt = now;
    if (action === 'lock') data.lockedAt = now;
    if (action === 'reopen') {
      data.submittedAt = null;
      data.validatedAt = null;
    }
    // Only if nobody moved it meanwhile: two officers clicking at once get one step, not two.
    const moved = await this.db.assessment.updateMany({
      where: { id, status: row.status as AssessmentStatus },
      data,
    });
    if (moved.count === 0) {
      throw fail(409, { code: 'ASSESSMENT_CHANGED', message: 'Someone else just changed this assessment. Refresh and try again.' });
    }
    const place = await this.place(row.sectionId, row.subjectId);
    await this.log(actor, ACTION_LOG[action], id, {
      name: row.name,
      section: place.label,
      subject: place.code,
      from: row.status,
      to: next,
    }, ip);
    return this.view(await this.find(id));
  }

  // ------------------------------------------------------------- marks

  /** The mark sheet: the section's students (by name) with their marks. */
  async marks(actor: AuthContext, id: string): Promise<MarkSheet> {
    this.requireSchool();
    const row = await this.find(id);
    await this.assertOwnClass(actor, row);
    return this.sheet(row);
  }

  /**
   * Saves marks typed on the sheet. While open: the class teacher (or the
   * exam officer). Once locked: only with assessment.marks.override and a
   * reason; every changed mark is audited with its old and new value.
   */
  async saveMarks(actor: AuthContext, id: string, dto: SaveMarksDto, ip: string | null): Promise<MarkSheet> {
    const tenantId = this.requireSchool();
    const row = await this.find(id);
    const permissions = await this.auth.permissionsOf(actor.userId);
    const locked = row.status === 'locked';
    if (locked) {
      if (!permissions.has('assessment.marks.override')) {
        throw fail(403, { code: 'MARKS_LOCKED', message: 'These marks are locked. Only the exam officer can change them, with a reason.' });
      }
      const noReason = checkOverrideReason(dto.reason);
      if (noReason) throw fail(400, noReason);
    } else {
      if (!permissions.has('assessment.marks.enter')) {
        throw fail(403, { code: 'PERMISSION_DENIED', message: 'You do not have permission to enter marks (needs assessment.marks.enter).' });
      }
      await this.assertOwnClass(actor, row);
    }
    const writable = checkMarksWritable(row.status as AssessmentStatus, locked);
    if (writable) throw fail(409, writable);

    const [roster, stored] = await Promise.all([
      this.enrollment.rosterOf(row.sectionId, row.academicYearId),
      this.storedMarks(row.id),
    ]);
    const allowed = new Set([...roster.map((r) => r.studentId), ...stored.map((m) => m.studentId)]);

    const incoming = new Map<string, MarkValue>();
    const errors: { studentId: string; code: string; message: string }[] = [];
    for (const cell of dto.marks) {
      if (incoming.has(cell.studentId)) {
        throw fail(400, { code: 'DUPLICATE_STUDENT', message: 'A student appears twice in the list.', studentId: cell.studentId });
      }
      if (!allowed.has(cell.studentId)) {
        throw fail(400, {
          code: 'STUDENT_NOT_IN_SECTION',
          message: 'One of these students is not in this section.',
          studentId: cell.studentId,
        });
      }
      const raw = cell.value === undefined ? null : cell.value;
      if (raw !== null && typeof raw !== 'number' && typeof raw !== 'string') {
        errors.push({ studentId: cell.studentId, code: 'MARK_INVALID', message: 'A mark must be a number or ABS.' });
        continue;
      }
      const parsed = parseMark(raw, row.maxScore);
      if (isProblem(parsed)) errors.push({ studentId: cell.studentId, code: parsed.code, message: parsed.message });
      else incoming.set(cell.studentId, parsed);
    }
    if (errors.length > 0) {
      throw fail(400, {
        code: 'MARKS_INVALID',
        message: errors.length === 1 ? errors[0].message : `${errors.length} marks need correcting.`,
        errors,
      });
    }

    const changes = diffMarks(stored, incoming);
    if (changes.length === 0) return this.sheet(row);
    const storedId = new Map(stored.map((m) => [m.studentId, m.id]));
    await this.db.$transaction(async (tx) => {
      for (const c of changes) {
        const existing = storedId.get(c.studentId);
        const empty = c.after.score === null && !c.after.absent;
        if (empty) {
          if (existing) await tx.mark.delete({ where: { id: existing } });
        } else if (existing) {
          await tx.mark.update({ where: { id: existing }, data: { score: c.after.score, absent: c.after.absent } });
        } else {
          await tx.mark.create({
            data: { tenantId, assessmentId: row.id, studentId: c.studentId, score: c.after.score, absent: c.after.absent },
          });
        }
      }
    });

    const place = await this.place(row.sectionId, row.subjectId);
    if (locked) {
      const names = new Map(roster.map((r) => [r.studentId, r.fullName]));
      const show = (m: MarkValue | null) => (!m ? null : m.absent ? 'ABS' : m.score);
      for (const c of changes) {
        await this.log(actor, 'assessment.mark.overridden', row.id, {
          name: row.name,
          section: place.label,
          subject: place.code,
          studentId: c.studentId,
          student: names.get(c.studentId) ?? null,
          before: show(c.before),
          after: show(c.after),
          reason: dto.reason!.trim(),
        }, ip);
      }
    } else {
      await this.log(actor, 'assessment.marks.saved', row.id, {
        name: row.name,
        section: place.label,
        subject: place.code,
        changed: changes.length,
      }, ip);
    }
    return this.sheet(row);
  }

  private async storedMarks(assessmentId: string): Promise<(StoredMark & { id: string })[]> {
    const rows = await this.db.mark.findMany({ where: { assessmentId }, select: MARK_SELECT });
    // score is a Decimal in the database; the rules work with numbers.
    return rows.map((m) => ({ id: m.id, studentId: m.studentId, score: m.score === null ? null : Number(m.score), absent: m.absent }));
  }

  private async sheet(row: AssessmentRow): Promise<MarkSheet> {
    const [roster, stored, view] = await Promise.all([
      this.enrollment.rosterOf(row.sectionId, row.academicYearId),
      this.storedMarks(row.id),
      this.view(row),
    ]);
    const missing = stored.map((m) => m.studentId).filter((sid) => !roster.some((r) => r.studentId === sid));
    const others = missing.length
      ? (
          await this.db.student.findMany({
            where: { id: { in: missing } },
            select: { id: true, matricule: true, firstName: true, lastName: true, gender: true },
          })
        ).map((s) => ({ studentId: s.id, matricule: s.matricule, fullName: `${s.lastName} ${s.firstName}`, gender: s.gender }))
      : [];
    const students = buildSheet(
      roster.map((r) => ({ studentId: r.studentId, matricule: r.matricule, fullName: r.fullName, gender: r.gender })),
      stored,
      others,
    );
    const status = row.status as AssessmentStatus;
    return {
      assessment: view,
      students,
      summary: summarize(students, row.maxScore),
      editing: status === 'open' ? 'open' : status === 'locked' ? 'override' : 'closed',
    };
  }

  // ----------------------------------------------------------- helpers

  /** null: every class; otherwise the "sectionId|subjectId" cells the caller teaches. */
  private async scope(actor: AuthContext, yearId: string): Promise<Set<string> | null> {
    if ((await this.auth.permissionsOf(actor.userId)).has(ALL_CLASSES)) return null;
    return this.teaching.cellsOf(actor.userId, yearId);
  }

  private async assertOwnClass(
    actor: AuthContext,
    cell: { academicYearId: string; sectionId: string; subjectId: string },
  ): Promise<void> {
    const scope = await this.scope(actor, cell.academicYearId);
    if (!scope || scope.has(cellKey(cell.sectionId, cell.subjectId))) return;
    throw fail(403, {
      code: 'NOT_YOUR_CLASS',
      message: 'Only the teacher assigned to this subject in this section (or the exam officer) can do this.',
    });
  }

  /** The section and its class subject; the subject must be taught in the class. */
  private async place(sectionId: string, subjectId: string): Promise<{ label: string; code: string }> {
    const section = await this.db.section.findFirst({ where: { id: sectionId }, select: { id: true, classId: true, name: true } });
    if (!section) throw fail(404, { code: 'SECTION_NOT_FOUND', message: 'This section does not exist in your school.' });
    const [schoolClass, link, subject] = await Promise.all([
      this.db.schoolClass.findFirst({ where: { id: section.classId }, select: { name: true } }),
      this.db.classSubject.findFirst({ where: { classId: section.classId, subjectId }, select: { subjectId: true } }),
      this.db.subject.findFirst({ where: { id: subjectId }, select: { code: true } }),
    ]);
    const label = `${schoolClass?.name ?? '?'} ${section.name}`;
    if (!link || !subject) {
      throw fail(400, {
        code: 'SUBJECT_NOT_IN_CLASS',
        message: `This subject is not taught in ${schoolClass?.name ?? 'this class'}. Add it to the class subjects first.`,
      });
    }
    return { label, code: subject.code };
  }

  private async lookups(): Promise<Lookups> {
    const [terms, classes, sections, subjects] = await Promise.all([
      this.db.term.findMany({ select: { id: true, name: true, startDate: true } }),
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
      this.db.subject.findMany({ select: { id: true, code: true, name: true } }),
    ]);
    return {
      terms: new Map(terms.map((t) => [t.id, t])),
      sections: new Map(toSectionList(classes, sections).map((s) => [s.id, { id: s.id, label: s.label }])),
      subjects: new Map(subjects.map((s) => [s.id, s])),
    };
  }

  private async view(row: AssessmentRow): Promise<AssessmentView> {
    return toAssessmentView(row, await this.lookups());
  }

  private async find(id: string): Promise<AssessmentRow> {
    const row = await this.db.assessment.findFirst({ where: { id }, select: ASSESSMENT_SELECT });
    if (!row) throw fail(404, { code: 'ASSESSMENT_NOT_FOUND', message: 'This assessment does not exist in your school.' });
    return row;
  }

  private async findYear(id: string): Promise<void> {
    const year = await this.db.academicYear.findFirst({ where: { id }, select: { id: true } });
    if (!year) throw fail(404, { code: 'YEAR_NOT_FOUND', message: 'This academic year does not exist in your school.' });
  }

  private async currentYearId(): Promise<string | null> {
    const year = await this.db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    return year?.id ?? null;
  }

  private async assertNameFree(name: string, termId: string, sectionId: string, subjectId: string, ignoreId?: string) {
    const others = await this.db.assessment.findMany({ where: { termId, sectionId, subjectId }, select: { id: true, name: true } });
    if (nameTaken(name, others, (o) => o.name, ignoreId)) throw this.nameTakenError(name);
  }

  private nameTakenError(name: string): HttpException {
    return fail(409, { code: 'NAME_TAKEN', message: `${name} already exists for this subject, section and term.` });
  }

  private heldOn(value: string | null | undefined, term: { name: string; startDate: Date; endDate: Date }): Date | null {
    if (value === undefined || value === null) return null;
    const day = parseDay(value);
    if (!day) throw fail(400, { code: 'DATE_INVALID', message: `${value} is not a real date.` });
    this.check(checkHeldOn(day, term));
    return day;
  }

  /** Changing or deleting a submitted, validated or locked assessment is a conflict with its state. */
  private assertEditable(row: AssessmentRow): void {
    const problem = checkEditable(row.status as AssessmentStatus);
    if (problem) throw fail(409, problem);
  }

  private check(problem: Problem | null): void {
    if (problem) throw fail(400, problem);
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
      entity: 'assessment',
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
