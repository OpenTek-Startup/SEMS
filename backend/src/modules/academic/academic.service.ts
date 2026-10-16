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
import {
  assembleClasses,
  checkRange,
  checkYearLength,
  cleanName,
  type ClassView,
  type DayRange,
  duplicates,
  findOverlap,
  nameTaken,
  normalizeSubjectCode,
  parseDay,
  type Problem,
  type SectionListItem,
  type SubjectView,
  termsOutside,
  toSectionList,
  toSubjectViews,
  toYearViews,
  type YearView,
} from './academic-rules';
import type {
  CreateClassDto,
  CreateSectionDto,
  CreateSubjectDto,
  CreateTermDto,
  CreateYearDto,
  SetClassSubjectsDto,
  UpdateClassDto,
  UpdateSectionDto,
  UpdateSubjectDto,
  UpdateTermDto,
  UpdateYearDto,
} from './dto/academic.dto';

const YEAR_SELECT = { id: true, name: true, startDate: true, endDate: true, isCurrent: true } satisfies Prisma.AcademicYearSelect;
const TERM_SELECT = { id: true, academicYearId: true, name: true, startDate: true, endDate: true } satisfies Prisma.TermSelect;
const CLASS_SELECT = { id: true, name: true, level: true } satisfies Prisma.SchoolClassSelect;
const SECTION_SELECT = { id: true, classId: true, name: true, capacity: true } satisfies Prisma.SectionSelect;
const SUBJECT_SELECT = { id: true, code: true, name: true } satisfies Prisma.SubjectSelect;
const CLASS_SUBJECT_SELECT = { classId: true, subjectId: true, coefficient: true } satisfies Prisma.ClassSubjectSelect;

/** The current academic year and term, for dashboards and later modules. */
export interface CurrentPeriod {
  year: { id: string; name: string; startDate: string; endDate: string } | null;
  term: { id: string; name: string; startDate: string; endDate: string } | null;
}

type Status = 400 | 404 | 409;

function fail(status: Status, problem: Problem): HttpException {
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

/** Prisma's "unique constraint failed" (two people saving the same name at once). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Academic structure of a school (module "academic"): years and terms,
 * classes and their sections, subjects and the coefficients per class.
 *
 * Everything goes through the school-scoped client: an id from another
 * school is "not found". Reads are flat queries assembled by the pure
 * rules in academic-rules.ts.
 */
@Injectable()
export class AcademicService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  // ===================================================== years and terms

  async years(): Promise<YearView[]> {
    this.requireSchool();
    const [years, terms] = await Promise.all([
      this.db.academicYear.findMany({ select: YEAR_SELECT }),
      this.db.term.findMany({ select: TERM_SELECT }),
    ]);
    return toYearViews(years, terms);
  }

  async current(): Promise<CurrentPeriod> {
    const year = (await this.years()).find((y) => y.isCurrent);
    if (!year) return { year: null, term: null };
    const term = year.terms.find((t) => t.isCurrent);
    return {
      year: { id: year.id, name: year.name, startDate: year.startDate, endDate: year.endDate },
      term: term ? { id: term.id, name: term.name, startDate: term.startDate, endDate: term.endDate } : null,
    };
  }

  async createYear(actor: AuthContext, dto: CreateYearDto, ip: string | null): Promise<YearView> {
    const tenantId = this.requireSchool();
    const name = cleanName(dto.name);
    const range = this.range(dto.startDate, dto.endDate);
    this.check(400, checkYearLength(range));

    const years = await this.db.academicYear.findMany({ select: YEAR_SELECT });
    this.assertNameFree(nameTaken(name, years, (y) => y.name), 'An academic year with this name already exists.');
    const clash = findOverlap(range, years);
    if (clash) {
      throw fail(409, {
        code: 'YEARS_OVERLAP',
        message: `These dates overlap the academic year ${clash.name}.`,
        with: clash.name,
      });
    }

    // The first year of a school becomes its current year.
    const isCurrent = !years.some((y) => y.isCurrent);
    const row = await this.unique(() =>
      this.db.academicYear.create({ data: { tenantId, name, ...range, isCurrent }, select: { id: true } }),
    );
    await this.log(actor, 'academic.year.created', 'academic_year', row.id, { name }, ip);
    return this.yearView(row.id);
  }

  async updateYear(actor: AuthContext, id: string, dto: UpdateYearDto, ip: string | null): Promise<YearView> {
    this.requireSchool();
    const year = await this.findYear(id);
    const name = dto.name === undefined ? year.name : cleanName(dto.name);
    const range = this.range(dto.startDate ?? year.startDate, dto.endDate ?? year.endDate);
    this.check(400, checkYearLength(range));

    const others = await this.db.academicYear.findMany({ where: { id: { not: id } }, select: YEAR_SELECT });
    this.assertNameFree(nameTaken(name, others, (y) => y.name), 'An academic year with this name already exists.');
    const clash = findOverlap(range, others);
    if (clash) {
      throw fail(409, { code: 'YEARS_OVERLAP', message: `These dates overlap the academic year ${clash.name}.`, with: clash.name });
    }
    const terms = await this.db.term.findMany({ where: { academicYearId: id }, select: TERM_SELECT });
    const outside = termsOutside(range, terms);
    if (outside.length > 0) {
      throw fail(409, {
        code: 'YEAR_TERMS_OUTSIDE',
        message: `These terms would fall outside the year: ${outside.join(', ')}. Change the terms first.`,
        terms: outside,
      });
    }

    await this.unique(() => this.db.academicYear.update({ where: { id }, data: { name, ...range } }));
    await this.log(actor, 'academic.year.updated', 'academic_year', id, { name }, ip);
    return this.yearView(id);
  }

  /** Makes this year the school's current year (only one at a time). */
  async setCurrentYear(actor: AuthContext, id: string, ip: string | null): Promise<YearView> {
    this.requireSchool();
    const year = await this.findYear(id);
    if (!year.isCurrent) {
      await this.db.$transaction(async (tx) => {
        await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
        await tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
      });
      await this.log(actor, 'academic.year.set_current', 'academic_year', id, { name: year.name }, ip);
    }
    return this.yearView(id);
  }

  async deleteYear(actor: AuthContext, id: string, ip: string | null): Promise<{ id: string; deleted: true }> {
    this.requireSchool();
    const year = await this.findYear(id);
    if (year.isCurrent) {
      throw fail(409, {
        code: 'YEAR_IS_CURRENT',
        message: 'This is the current academic year. Make another year current first.',
      });
    }
    if ((await this.db.term.count({ where: { academicYearId: id } })) > 0) {
      throw fail(409, { code: 'YEAR_NOT_EMPTY', message: 'Delete the terms of this year first.' });
    }
    await this.db.academicYear.delete({ where: { id } });
    await this.log(actor, 'academic.year.deleted', 'academic_year', id, { name: year.name }, ip);
    return { id, deleted: true };
  }

  async createTerm(actor: AuthContext, yearId: string, dto: CreateTermDto, ip: string | null): Promise<YearView> {
    const tenantId = this.requireSchool();
    const year = await this.findYear(yearId);
    const name = cleanName(dto.name);
    const range = this.range(dto.startDate, dto.endDate);
    const terms = await this.db.term.findMany({ where: { academicYearId: yearId }, select: TERM_SELECT });
    this.checkTerm(year, name, range, terms);

    const row = await this.unique(() =>
      this.db.term.create({ data: { tenantId, academicYearId: yearId, name, ...range }, select: { id: true } }),
    );
    await this.log(actor, 'academic.term.created', 'term', row.id, { name, year: year.name }, ip);
    return this.yearView(yearId);
  }

  async updateTerm(actor: AuthContext, id: string, dto: UpdateTermDto, ip: string | null): Promise<YearView> {
    this.requireSchool();
    const term = await this.findTerm(id);
    const year = await this.findYear(term.academicYearId);
    const name = dto.name === undefined ? term.name : cleanName(dto.name);
    const range = this.range(dto.startDate ?? term.startDate, dto.endDate ?? term.endDate);
    const others = await this.db.term.findMany({
      where: { academicYearId: year.id, id: { not: id } },
      select: TERM_SELECT,
    });
    this.checkTerm(year, name, range, others);

    await this.unique(() => this.db.term.update({ where: { id }, data: { name, ...range } }));
    await this.log(actor, 'academic.term.updated', 'term', id, { name, year: year.name }, ip);
    return this.yearView(year.id);
  }

  async deleteTerm(actor: AuthContext, id: string, ip: string | null): Promise<YearView> {
    this.requireSchool();
    const term = await this.findTerm(id);
    await this.db.term.delete({ where: { id } });
    await this.log(actor, 'academic.term.deleted', 'term', id, { name: term.name }, ip);
    return this.yearView(term.academicYearId);
  }

  // ================================================== classes and sections

  async classes(): Promise<ClassView[]> {
    this.requireSchool();
    const [classes, sections, classSubjects, subjects] = await Promise.all([
      this.db.schoolClass.findMany({ select: CLASS_SELECT }),
      this.db.section.findMany({ select: SECTION_SELECT }),
      this.db.classSubject.findMany({ select: CLASS_SUBJECT_SELECT }),
      this.db.subject.findMany({ select: SUBJECT_SELECT }),
    ]);
    return assembleClasses(classes, sections, classSubjects, subjects);
  }

  /** Every section as one flat list ("Form 1 A", ...), for pickers. */
  async sections(): Promise<SectionListItem[]> {
    this.requireSchool();
    const [classes, sections] = await Promise.all([
      this.db.schoolClass.findMany({ select: CLASS_SELECT }),
      this.db.section.findMany({ select: SECTION_SELECT }),
    ]);
    return toSectionList(classes, sections);
  }

  async createClass(actor: AuthContext, dto: CreateClassDto, ip: string | null): Promise<ClassView> {
    const tenantId = this.requireSchool();
    const name = cleanName(dto.name);
    const classes = await this.db.schoolClass.findMany({ select: CLASS_SELECT });
    this.assertNameFree(nameTaken(name, classes, (c) => c.name), 'A class with this name already exists.');

    const row = await this.unique(() =>
      this.db.schoolClass.create({ data: { tenantId, name, level: dto.level }, select: { id: true } }),
    );
    await this.log(actor, 'academic.class.created', 'class', row.id, { name }, ip);
    return this.classView(row.id);
  }

  async updateClass(actor: AuthContext, id: string, dto: UpdateClassDto, ip: string | null): Promise<ClassView> {
    this.requireSchool();
    const current = await this.findClass(id);
    const name = dto.name === undefined ? current.name : cleanName(dto.name);
    const others = await this.db.schoolClass.findMany({ where: { id: { not: id } }, select: CLASS_SELECT });
    this.assertNameFree(nameTaken(name, others, (c) => c.name), 'A class with this name already exists.');

    await this.unique(() =>
      this.db.schoolClass.update({ where: { id }, data: { name, level: dto.level ?? current.level } }),
    );
    await this.log(actor, 'academic.class.updated', 'class', id, { name }, ip);
    return this.classView(id);
  }

  async deleteClass(actor: AuthContext, id: string, ip: string | null): Promise<{ id: string; deleted: true }> {
    this.requireSchool();
    const current = await this.findClass(id);
    if ((await this.db.section.count({ where: { classId: id } })) > 0) {
      throw fail(409, { code: 'CLASS_NOT_EMPTY', message: 'Delete the sections of this class first.' });
    }
    await this.db.$transaction(async (tx) => {
      await tx.classSubject.deleteMany({ where: { classId: id } });
      await tx.schoolClass.delete({ where: { id } });
    });
    await this.log(actor, 'academic.class.deleted', 'class', id, { name: current.name }, ip);
    return { id, deleted: true };
  }

  async createSection(actor: AuthContext, classId: string, dto: CreateSectionDto, ip: string | null): Promise<ClassView> {
    const tenantId = this.requireSchool();
    const schoolClass = await this.findClass(classId);
    const name = cleanName(dto.name);
    const sections = await this.db.section.findMany({ where: { classId }, select: SECTION_SELECT });
    this.assertNameFree(nameTaken(name, sections, (s) => s.name), `${schoolClass.name} already has a section ${name}.`);

    const row = await this.unique(() =>
      this.db.section.create({
        data: { tenantId, classId, name, capacity: dto.capacity ?? null },
        select: { id: true },
      }),
    );
    await this.log(actor, 'academic.section.created', 'section', row.id, { name: `${schoolClass.name} ${name}` }, ip);
    return this.classView(classId);
  }

  async updateSection(actor: AuthContext, id: string, dto: UpdateSectionDto, ip: string | null): Promise<ClassView> {
    this.requireSchool();
    const section = await this.findSection(id);
    const schoolClass = await this.findClass(section.classId);
    const name = dto.name === undefined ? section.name : cleanName(dto.name);
    const others = await this.db.section.findMany({
      where: { classId: section.classId, id: { not: id } },
      select: SECTION_SELECT,
    });
    this.assertNameFree(nameTaken(name, others, (s) => s.name), `${schoolClass.name} already has a section ${name}.`);

    await this.unique(() =>
      this.db.section.update({
        where: { id },
        data: { name, capacity: dto.capacity === undefined ? section.capacity : dto.capacity },
      }),
    );
    await this.log(actor, 'academic.section.updated', 'section', id, { name: `${schoolClass.name} ${name}` }, ip);
    return this.classView(section.classId);
  }

  async deleteSection(actor: AuthContext, id: string, ip: string | null): Promise<ClassView> {
    this.requireSchool();
    const section = await this.findSection(id);
    const schoolClass = await this.findClass(section.classId);
    await this.db.section.delete({ where: { id } });
    await this.log(actor, 'academic.section.deleted', 'section', id, { name: `${schoolClass.name} ${section.name}` }, ip);
    return this.classView(section.classId);
  }

  /** Replaces the subject list (with coefficients) of a class. */
  async setClassSubjects(actor: AuthContext, classId: string, dto: SetClassSubjectsDto, ip: string | null): Promise<ClassView> {
    const tenantId = this.requireSchool();
    const schoolClass = await this.findClass(classId);
    const ids = dto.subjects.map((s) => s.subjectId);
    if (duplicates(ids).length > 0) {
      throw fail(400, { code: 'DUPLICATE_SUBJECT', message: 'A subject appears twice in the list.' });
    }
    if (ids.length > 0) {
      const found = await this.db.subject.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) {
        throw fail(400, { code: 'UNKNOWN_SUBJECT', message: 'One or more subjects do not exist in your school.' });
      }
    }

    await this.db.$transaction(async (tx) => {
      await tx.classSubject.deleteMany({ where: { classId } });
      if (dto.subjects.length > 0) {
        await tx.classSubject.createMany({
          data: dto.subjects.map((s) => ({ tenantId, classId, subjectId: s.subjectId, coefficient: s.coefficient })),
        });
      }
    });
    await this.log(
      actor,
      'academic.class.subjects_updated',
      'class',
      classId,
      { name: schoolClass.name, subjects: dto.subjects.length },
      ip,
    );
    return this.classView(classId);
  }

  // ============================================================ subjects

  async subjects(): Promise<SubjectView[]> {
    this.requireSchool();
    const [subjects, classSubjects] = await Promise.all([
      this.db.subject.findMany({ select: SUBJECT_SELECT }),
      this.db.classSubject.findMany({ select: CLASS_SUBJECT_SELECT }),
    ]);
    return toSubjectViews(subjects, classSubjects);
  }

  async createSubject(actor: AuthContext, dto: CreateSubjectDto, ip: string | null): Promise<SubjectView> {
    const tenantId = this.requireSchool();
    const code = this.subjectCode(dto.code);
    const name = cleanName(dto.name);
    const subjects = await this.db.subject.findMany({ select: SUBJECT_SELECT });
    this.assertSubjectFree(subjects, code, name);

    const row = await this.unique(() =>
      this.db.subject.create({ data: { tenantId, code, name }, select: { id: true } }),
    );
    await this.log(actor, 'academic.subject.created', 'subject', row.id, { name, code }, ip);
    return this.subjectView(row.id);
  }

  async updateSubject(actor: AuthContext, id: string, dto: UpdateSubjectDto, ip: string | null): Promise<SubjectView> {
    this.requireSchool();
    const current = await this.findSubject(id);
    const code = dto.code === undefined ? current.code : this.subjectCode(dto.code);
    const name = dto.name === undefined ? current.name : cleanName(dto.name);
    const others = await this.db.subject.findMany({ where: { id: { not: id } }, select: SUBJECT_SELECT });
    this.assertSubjectFree(others, code, name);

    await this.unique(() => this.db.subject.update({ where: { id }, data: { code, name } }));
    await this.log(actor, 'academic.subject.updated', 'subject', id, { name, code }, ip);
    return this.subjectView(id);
  }

  async deleteSubject(actor: AuthContext, id: string, ip: string | null): Promise<{ id: string; deleted: true }> {
    this.requireSchool();
    const subject = await this.findSubject(id);
    const uses = await this.db.classSubject.findMany({ where: { subjectId: id }, select: CLASS_SUBJECT_SELECT });
    if (uses.length > 0) {
      const classes = await this.db.schoolClass.findMany({
        where: { id: { in: uses.map((u) => u.classId) } },
        select: CLASS_SELECT,
      });
      const names = assembleClasses(classes, [], [], []).map((c) => c.name);
      throw fail(409, {
        code: 'SUBJECT_IN_USE',
        message: `${subject.name} is taught in ${names.join(', ')}. Remove it from these classes first.`,
        classes: names,
      });
    }
    await this.db.subject.delete({ where: { id } });
    await this.log(actor, 'academic.subject.deleted', 'subject', id, { name: subject.name, code: subject.code }, ip);
    return { id, deleted: true };
  }

  // ============================================================= helpers

  private async yearView(id: string): Promise<YearView> {
    const year = await this.findYear(id);
    const terms = await this.db.term.findMany({ where: { academicYearId: id }, select: TERM_SELECT });
    return toYearViews([year], terms)[0];
  }

  private async classView(id: string): Promise<ClassView> {
    const schoolClass = await this.findClass(id);
    const [sections, classSubjects] = await Promise.all([
      this.db.section.findMany({ where: { classId: id }, select: SECTION_SELECT }),
      this.db.classSubject.findMany({ where: { classId: id }, select: CLASS_SUBJECT_SELECT }),
    ]);
    const subjects = classSubjects.length
      ? await this.db.subject.findMany({
          where: { id: { in: classSubjects.map((cs) => cs.subjectId) } },
          select: SUBJECT_SELECT,
        })
      : [];
    return assembleClasses([schoolClass], sections, classSubjects, subjects)[0];
  }

  private async subjectView(id: string): Promise<SubjectView> {
    const subject = await this.findSubject(id);
    const classSubjects = await this.db.classSubject.findMany({ where: { subjectId: id }, select: CLASS_SUBJECT_SELECT });
    return toSubjectViews([subject], classSubjects)[0];
  }

  private async findYear(id: string) {
    const row = await this.db.academicYear.findFirst({ where: { id }, select: YEAR_SELECT });
    if (!row) throw fail(404, { code: 'YEAR_NOT_FOUND', message: 'This academic year does not exist in your school.' });
    return row;
  }

  private async findTerm(id: string) {
    const row = await this.db.term.findFirst({ where: { id }, select: TERM_SELECT });
    if (!row) throw fail(404, { code: 'TERM_NOT_FOUND', message: 'This term does not exist in your school.' });
    return row;
  }

  private async findClass(id: string) {
    const row = await this.db.schoolClass.findFirst({ where: { id }, select: CLASS_SELECT });
    if (!row) throw fail(404, { code: 'CLASS_NOT_FOUND', message: 'This class does not exist in your school.' });
    return row;
  }

  private async findSection(id: string) {
    const row = await this.db.section.findFirst({ where: { id }, select: SECTION_SELECT });
    if (!row) throw fail(404, { code: 'SECTION_NOT_FOUND', message: 'This section does not exist in your school.' });
    return row;
  }

  private async findSubject(id: string) {
    const row = await this.db.subject.findFirst({ where: { id }, select: SUBJECT_SELECT });
    if (!row) throw fail(404, { code: 'SUBJECT_NOT_FOUND', message: 'This subject does not exist in your school.' });
    return row;
  }

  /** Parses both days and checks that the end comes after the start. */
  private range(start: string | Date, end: string | Date): DayRange {
    const startDate = start instanceof Date ? start : this.day(start, 'startDate');
    const endDate = end instanceof Date ? end : this.day(end, 'endDate');
    const range = { startDate, endDate };
    this.check(400, checkRange(range));
    return range;
  }

  private day(value: string, field: string): Date {
    const date = parseDay(value);
    if (!date) throw fail(400, { code: 'DATE_INVALID', message: `${field} is not a real date (${value}).` });
    return date;
  }

  /** A term must fit inside its year, not overlap another term, and have its own name. */
  private checkTerm(
    year: DayRange & { name: string },
    name: string,
    range: DayRange,
    otherTerms: readonly (DayRange & { id: string; name: string })[],
  ): void {
    if (termsOutside(year, [{ name, ...range }]).length > 0) {
      throw fail(400, {
        code: 'TERM_OUTSIDE_YEAR',
        message: `A term of ${year.name} must fall between its start and end dates.`,
      });
    }
    this.assertNameFree(nameTaken(name, otherTerms, (t) => t.name), `${year.name} already has a term called ${name}.`);
    const clash = findOverlap(range, otherTerms);
    if (clash) {
      throw fail(409, { code: 'TERMS_OVERLAP', message: `These dates overlap ${clash.name}.`, with: clash.name });
    }
  }

  private subjectCode(value: string): string {
    const code = normalizeSubjectCode(value);
    if (!code) {
      throw fail(400, { code: 'SUBJECT_CODE_INVALID', message: 'The code must be 1 to 12 letters, digits or dashes.' });
    }
    return code;
  }

  private assertSubjectFree(subjects: readonly { id: string; code: string; name: string }[], code: string, name: string) {
    if (subjects.some((s) => s.code === code)) {
      throw fail(409, { code: 'CODE_TAKEN', message: `Another subject already uses the code ${code}.` });
    }
    this.assertNameFree(nameTaken(name, subjects, (s) => s.name), 'A subject with this name already exists.');
  }

  private assertNameFree(clash: unknown, message: string): void {
    if (clash) throw fail(409, { code: 'NAME_TAKEN', message });
  }

  private check(status: Status, problem: Problem | null): void {
    if (problem) throw fail(status, problem);
  }

  /** Turns a database unique-constraint race into the same 409 as the checks above. */
  private async unique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw fail(409, { code: 'NAME_TAKEN', message: 'This name or code is already used. Refresh and try again.' });
      }
      throw err;
    }
  }

  private log(
    actor: AuthContext,
    action: string,
    entity: string,
    entityId: string,
    detail: Prisma.InputJsonObject,
    ipAddress: string | null,
  ): Promise<void> {
    return this.audit.record({ action, tenantId: actor.tenantId, actorUserId: actor.userId, entity, entityId, detail, ipAddress });
  }

  private requireSchool(): string {
    const tenantId = currentTenantId();
    if (!tenantId) throw fail(400, { code: 'SCHOOL_REQUIRED', message: 'This action needs a school.' });
    return tenantId;
  }
}
