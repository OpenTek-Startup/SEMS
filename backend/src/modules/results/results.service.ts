import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { currentTenant, currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { naturalCompare } from '../academic/academic-rules';
import { EnrollmentService } from '../enrollment/enrollment.service';
import type { Problem } from '../staff/staff-rules';
import {
  computeTerm,
  type ReportCardData,
  type ResultSubject,
  type TermResults,
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

function fail(status: 400 | 404, problem: Problem): HttpException {
  return status === 404 ? new NotFoundException(problem) : new BadRequestException(problem);
}

/**
 * Results (module "results"): term averages, ranks and class statistics of
 * a section, computed on demand from the marks (results-rules.ts does the
 * arithmetic). Only locked assessments count, unless a provisional preview
 * is asked for.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly enrollment: EnrollmentService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  async section(termId: string, sectionId: string, provisional: boolean): Promise<SectionResults> {
    this.requireSchool();
    const term = await this.db.term.findFirst({ where: { id: termId }, select: { id: true, name: true, academicYearId: true } });
    if (!term) throw fail(404, { code: 'TERM_NOT_FOUND', message: 'This term does not exist in your school.' });
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

  /** One report card per student of the section, in rank order (the shape of report-card.sample.json). */
  async reportCards(termId: string, sectionId: string, provisional: boolean): Promise<ReportCardData[]> {
    const r = await this.section(termId, sectionId, provisional);
    return toReportCards(
      { school: { name: currentTenant()?.name ?? '' }, year: r.year, term: r.term, section: r.section },
      r.results,
    );
  }

  private requireSchool(): string {
    const tenantId = currentTenantId();
    if (!tenantId) throw fail(400, { code: 'SCHOOL_REQUIRED', message: 'This action needs a school.' });
    return tenantId;
  }
}
