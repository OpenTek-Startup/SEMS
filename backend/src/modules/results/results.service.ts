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
import { currentTenant, currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { naturalCompare, toSectionList } from '../academic/academic-rules';
import { EnrollmentService } from '../enrollment/enrollment.service';
import type { Problem } from '../staff/staff-rules';
import {
  type AnnualResults,
  changesSincePublication,
  checkPublishable,
  computeAnnual,
  computeTerm,
  type TermOfYear,
  type ReportCardData,
  type ResultChange,
  type ResultSubject,
  type SummaryClassInput,
  type TermResults,
  type StudentYear,
  type TermSummary,
  studentYear,
  termSummary,
  toReportCards,
} from './results-rules';

/** Results of one section for one term, with what was counted. */
export interface SectionResults {
  year: { id: string; name: string };
  term: { id: string; name: string };
  section: { id: string; label: string };
  /** true: submitted and validated assessments were counted too (not final) */
  provisional: boolean;
  /** the assessments counted, per subject */
  counted: { id: string; subjectId: string; name: string; status: string }[];
  /** assessments of the term not counted yet (still open, or not locked) */
  pending: number;
  results: TermResults;
}

/** Who published a section's results, and when. */
export interface PublicationInfo {
  version: number;
  publishedAt: string;
  publishedBy: string;
}

/** The live results, with the publication state of the section. */
export interface SectionResultsView extends SectionResults {
  publication: PublicationInfo | null;
  /** students whose average or rank would change if republished now (empty when up to date or not published) */
  changesSincePublication: ResultChange[];
}

/** One line of the publication overview of a term. */
export interface PublicationLine {
  sectionId: string;
  label: string;
  publication: PublicationInfo | null;
}

const PUBLICATION_SELECT = {
  id: true,
  termId: true,
  sectionId: true,
  version: true,
  publishedAt: true,
  publishedByName: true,
  snapshot: true,
} satisfies Prisma.ResultPublicationSelect;

function fail(status: 400 | 404 | 409, problem: Problem): HttpException {
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

const infoOf = (p: { version: number; publishedAt: Date; publishedByName: string }): PublicationInfo => ({
  version: p.version,
  publishedAt: p.publishedAt.toISOString(),
  publishedBy: p.publishedByName,
});

/**
 * Results (module "results"): term averages, ranks and class statistics of
 * a section, computed on demand from the marks (results-rules.ts does the
 * arithmetic). Only locked assessments count, unless a provisional preview
 * is asked for.
 *
 * Publishing freezes a copy of the results of a section for a term
 * (results.publish). Report cards print from that copy, so a mark changed
 * later (override) does not silently change a published report card: the
 * results page lists what would change, and the exam officer republishes.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly enrollment: EnrollmentService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  /** The live results with their publication state (what the Results page shows). */
  async section(termId: string, sectionId: string, provisional: boolean): Promise<SectionResultsView> {
    const live = await this.compute(termId, sectionId, provisional);
    const published = await this.findPublication(termId, sectionId);
    if (!published) return { ...live, publication: null, changesSincePublication: [] };
    // Compare with the official (locked-only) results, whatever the preview setting.
    const official = provisional ? await this.compute(termId, sectionId, false) : live;
    return {
      ...live,
      publication: infoOf(published),
      changesSincePublication: changesSincePublication(
        (published.snapshot as unknown as SectionResults).results,
        official.results,
      ),
    };
  }

  /** Results of one section for one term, computed now from the marks. */
  private async compute(termId: string, sectionId: string, provisional: boolean): Promise<SectionResults> {
    this.requireSchool();
    const term = await this.findTerm(termId);
    const yearRow = (await this.db.academicYear.findFirst({ where: { id: term.academicYearId }, select: { id: true, name: true } }))!;
    const year = { id: yearRow.id, name: yearRow.name };
    const section = await this.db.section.findFirst({ where: { id: sectionId }, select: { id: true, classId: true, name: true } });
    if (!section) throw fail(404, { code: 'SECTION_NOT_FOUND', message: 'This section does not exist in your school.' });
    const schoolClass = await this.db.schoolClass.findFirst({ where: { id: section.classId }, select: { name: true } });
    const label = `${schoolClass?.name ?? '?'} ${section.name}`;

    const [classSubjects, subjects, assignments, assessments, roster] = await Promise.all([
      this.db.classSubject.findMany({ where: { classId: section.classId }, select: { subjectId: true, coefficient: true } }),
      this.db.subject.findMany({ select: { id: true, code: true, name: true } }),
      this.db.teacherAssignment.findMany({
        where: { academicYearId: year.id, sectionId },
        select: { subjectId: true, staffMemberId: true },
      }),
      this.db.assessment.findMany({
        where: { termId, sectionId },
        select: { id: true, subjectId: true, name: true, maxScore: true, weight: true, status: true },
      }),
      this.enrollment.rosterOf(sectionId, year.id),
    ]);
    const staff = assignments.length
      ? await this.db.staffMember.findMany({
          where: { id: { in: assignments.map((a) => a.staffMemberId) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const staffName = new Map(staff.map((s) => [s.id, `${s.lastName} ${s.firstName}`]));
    const teacherOf = new Map(assignments.map((a) => [a.subjectId, staffName.get(a.staffMemberId) ?? null]));
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const resultSubjects: ResultSubject[] = classSubjects
      .filter((cs) => subjectById.has(cs.subjectId))
      .map((cs) => {
        const s = subjectById.get(cs.subjectId)!;
        return { subjectId: s.id, code: s.code, name: s.name, coefficient: cs.coefficient, teacher: teacherOf.get(s.id) ?? null };
      })
      .sort((a, b) => b.coefficient - a.coefficient || naturalCompare(a.name, b.name));

    const countable = provisional ? new Set(['submitted', 'validated', 'locked']) : new Set(['locked']);
    const counted = assessments.filter((a) => countable.has(a.status));
    const marks = counted.length
      ? await this.db.mark.findMany({
          where: { assessmentId: { in: counted.map((a) => a.id) } },
          select: { assessmentId: true, studentId: true, score: true, absent: true },
        })
      : [];

    const results = computeTerm({
      subjects: resultSubjects,
      assessments: counted.map((a) => ({ id: a.id, subjectId: a.subjectId, name: a.name, maxScore: a.maxScore, weight: a.weight })),
      // score is a Decimal in the database; the rules work with numbers.
      marks: marks.map((m) => ({
        assessmentId: m.assessmentId,
        studentId: m.studentId,
        score: m.score === null ? null : Number(m.score),
        absent: m.absent,
      })),
      students: roster.map((r) => ({ studentId: r.studentId, matricule: r.matricule, fullName: r.fullName })),
    });

    return {
      year,
      term: { id: term.id, name: term.name },
      section: { id: section.id, label },
      provisional,
      counted: counted.map((a) => ({ id: a.id, subjectId: a.subjectId, name: a.name, status: a.status })),
      pending: assessments.length - counted.length,
      results,
    };
  }

  /**
   * One report card per student of the section, in rank order (the shape of
   * report-card.sample.json). From the published copy when the results are
   * published; otherwise computed now and marked provisional.
   */
  async reportCards(termId: string, sectionId: string, provisional: boolean): Promise<ReportCardData[]> {
    this.requireSchool();
    const published = provisional ? null : await this.findPublication(termId, sectionId);
    const r = published ? (published.snapshot as unknown as SectionResults) : await this.compute(termId, sectionId, provisional);
    return toReportCards(
      {
        school: { name: currentTenant()?.name ?? '' },
        year: r.year,
        term: r.term,
        section: r.section,
        published: published !== null,
        publishedAt: published ? published.publishedAt.toISOString() : null,
      },
      r.results,
    );
  }

  /** Every section of the term's year with its publication state (overview for the exam officer). */
  async publications(termId: string): Promise<{ term: { id: string; name: string }; sections: PublicationLine[] }> {
    this.requireSchool();
    const term = await this.findTerm(termId);
    const [classes, sections, rows] = await Promise.all([
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
      this.db.resultPublication.findMany({
        where: { termId },
        select: { sectionId: true, version: true, publishedAt: true, publishedByName: true },
      }),
    ]);
    const bySection = new Map(rows.map((r) => [r.sectionId, r]));
    return {
      term: { id: term.id, name: term.name },
      sections: toSectionList(classes, sections).map((s) => {
        const p = bySection.get(s.id);
        return { sectionId: s.id, label: s.label, publication: p ? infoOf(p) : null };
      }),
    };
  }

  /**
   * The school's figures for a term (basic reporting): each class with students,
   * from its published copy, or from its locked assessments when not published.
   */
  async summary(termId: string): Promise<{ term: { id: string; name: string } } & TermSummary> {
    this.requireSchool();
    const term = await this.findTerm(termId);
    const [classes, sections] = await Promise.all([
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true, name: true, capacity: true } }),
    ]);
    const lines: SummaryClassInput[] = [];
    for (const s of toSectionList(classes, sections)) {
      const published = await this.findPublication(termId, s.id);
      if (published) {
        const copy = published.snapshot as unknown as SectionResults;
        lines.push({ sectionId: s.id, label: s.label, state: 'published', results: copy.results });
        continue;
      }
      const r = await this.compute(termId, s.id, false);
      if (r.results.stats.size === 0) continue;
      const final = r.pending === 0 && r.counted.length > 0;
      lines.push({ sectionId: s.id, label: s.label, state: final ? 'final' : 'in_progress', results: r.results });
    }
    return { term: { id: term.id, name: term.name }, ...termSummary(lines) };
  }

  /** Publishes (or republishes) the final results of a section for a term. */
  async publish(actor: AuthContext, termId: string, sectionId: string, ip: string | null): Promise<SectionResultsView> {
    const tenantId = this.requireSchool();
    const live = await this.compute(termId, sectionId, false);
    const problem = checkPublishable({
      label: live.section.label,
      termName: live.term.name,
      counted: live.counted.length,
      pending: live.pending,
      classified: live.results.stats.classified,
    });
    if (problem) throw fail(409, problem);

    const user = await this.db.user.findFirst({ where: { id: actor.userId }, select: { firstName: true, lastName: true } });
    const publishedByName = user ? `${user.firstName} ${user.lastName}`.trim() : '';
    const snapshot = live as unknown as Prisma.InputJsonValue;
    const existing = await this.findPublication(termId, sectionId);
    const now = new Date();
    let version = 1;
    if (existing) {
      version = existing.version + 1;
      await this.db.resultPublication.update({
        where: { id: existing.id },
        data: { version, publishedAt: now, publishedByUserId: actor.userId, publishedByName, snapshot },
      });
    } else {
      await this.db.resultPublication.create({
        data: { tenantId, termId, sectionId, version, publishedAt: now, publishedByUserId: actor.userId, publishedByName, snapshot },
      });
    }
    await this.audit.record({
      action: existing ? 'results.republished' : 'results.published',
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      entity: 'result_publication',
      entityId: sectionId,
      detail: {
        term: live.term.name,
        section: live.section.label,
        version,
        students: live.results.stats.classified,
        classAverage: live.results.stats.classAverage,
      },
      ipAddress: ip,
    });
    return this.section(termId, sectionId, false);
  }

  /** Withdraws published results (they go back to provisional). The reason is kept in the audit log. */
  async unpublish(
    actor: AuthContext,
    termId: string,
    sectionId: string,
    reason: string,
    ip: string | null,
  ): Promise<SectionResultsView> {
    this.requireSchool();
    const existing = await this.findPublication(termId, sectionId);
    if (!existing) {
      throw fail(409, { code: 'NOT_PUBLISHED', message: 'These results are not published.' });
    }
    const why = reason.trim().replace(/\s+/g, ' ');
    if (why.length < 10) {
      throw fail(400, { code: 'REASON_REQUIRED', message: 'Give the reason for withdrawing published results (at least 10 characters).' });
    }
    await this.db.resultPublication.delete({ where: { id: existing.id } });
    const snapshot = existing.snapshot as unknown as SectionResults;
    await this.audit.record({
      action: 'results.unpublished',
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      entity: 'result_publication',
      entityId: sectionId,
      detail: { term: snapshot.term.name, section: snapshot.section.label, version: existing.version, reason: why },
      ipAddress: ip,
    });
    return this.section(termId, sectionId, false);
  }

  /**
   * Annual results of a section: each term from its published copy, or
   * computed now from locked assessments when not published. Terms with
   * nothing locked and nothing published yet are left out.
   */
  async annual(
    sectionId: string,
    yearId?: string,
  ): Promise<{ year: { id: string; name: string }; section: { id: string; label: string } } & AnnualResults> {
    this.requireSchool();
    const year = await this.findYear(yearId);
    const section = await this.findSection(sectionId);
    return { year, section, ...computeAnnual(await this.termsOfYear(year.id, section.id)) };
  }

  /**
   * One student's results over a year (the student page): each term's subject
   * averages, average and rank, then the year average and decision, in the
   * class the student is in that year (the latest enrollment, if they moved).
   */
  async student(
    studentId: string,
    yearId?: string,
  ): Promise<
    {
      year: { id: string; name: string };
      student: { id: string; fullName: string; matricule: string };
      section: { id: string; label: string } | null;
    } & StudentYear
  > {
    this.requireSchool();
    const row = await this.db.student.findFirst({
      where: { id: studentId },
      select: { id: true, firstName: true, lastName: true, matricule: true },
    });
    if (!row) throw fail(404, { code: 'STUDENT_NOT_FOUND', message: 'This student does not exist in your school.' });
    const student = { id: row.id, fullName: `${row.lastName} ${row.firstName}`, matricule: row.matricule };
    const year = await this.findYear(yearId);
    // The active enrollment of the year, else the latest one (a student who left keeps their results).
    const enrollments = await this.db.enrollment.findMany({
      where: { academicYearId: year.id, studentId },
      select: { sectionId: true, status: true, enrolledOn: true },
    });
    const enrollment =
      enrollments.find((e) => e.status === 'active') ??
      [...enrollments].sort((a, b) => new Date(b.enrolledOn).getTime() - new Date(a.enrolledOn).getTime())[0];
    if (!enrollment) return { year, student, section: null, terms: [], annual: null, classified: 0 };
    const section = await this.findSection(enrollment.sectionId);
    return { year, student, section, ...studentYear(await this.termsOfYear(year.id, section.id), studentId) };
  }

  /**
   * The terms of a year for a section, in order: each from its published copy,
   * or computed now from locked assessments. Terms with nothing locked and
   * nothing published yet are left out.
   */
  private async termsOfYear(yearId: string, sectionId: string): Promise<TermOfYear[]> {
    const terms = await this.db.term.findMany({
      where: { academicYearId: yearId },
      select: { id: true, name: true, startDate: true },
    });
    terms.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const counted: TermOfYear[] = [];
    for (const term of terms) {
      const published = await this.findPublication(term.id, sectionId);
      const r = published ? (published.snapshot as unknown as SectionResults) : await this.compute(term.id, sectionId, false);
      if (!published && r.counted.length === 0) continue;
      counted.push({ termId: term.id, name: term.name, published: published !== null, results: r.results });
    }
    return counted;
  }

  /** The given academic year, or the current one. */
  private async findYear(yearId?: string): Promise<{ id: string; name: string }> {
    const yearRow = yearId
      ? await this.db.academicYear.findFirst({ where: { id: yearId }, select: { id: true, name: true } })
      : await this.db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    if (!yearRow) {
      throw yearId
        ? fail(404, { code: 'YEAR_NOT_FOUND', message: 'This academic year does not exist in your school.' })
        : fail(400, { code: 'YEAR_REQUIRED', message: 'There is no current academic year. Choose a year.' });
    }
    return { id: yearRow.id, name: yearRow.name };
  }

  private async findSection(sectionId: string): Promise<{ id: string; label: string }> {
    const sectionRow = await this.db.section.findFirst({ where: { id: sectionId }, select: { id: true, classId: true, name: true } });
    if (!sectionRow) throw fail(404, { code: 'SECTION_NOT_FOUND', message: 'This section does not exist in your school.' });
    const schoolClass = await this.db.schoolClass.findFirst({ where: { id: sectionRow.classId }, select: { name: true } });
    return { id: sectionRow.id, label: `${schoolClass?.name ?? '?'} ${sectionRow.name}` };
  }

  private async findPublication(termId: string, sectionId: string) {
    return this.db.resultPublication.findFirst({ where: { termId, sectionId }, select: PUBLICATION_SELECT });
  }

  private async findTerm(id: string): Promise<{ id: string; name: string; academicYearId: string }> {
    const term = await this.db.term.findFirst({ where: { id }, select: { id: true, name: true, academicYearId: true } });
    if (!term) throw fail(404, { code: 'TERM_NOT_FOUND', message: 'This term does not exist in your school.' });
    return { id: term.id, name: term.name, academicYearId: term.academicYearId };
  }

  private requireSchool(): string {
    const tenantId = currentTenantId();
    if (!tenantId) throw fail(400, { code: 'SCHOOL_REQUIRED', message: 'This action needs a school.' });
    return tenantId;
  }
}
