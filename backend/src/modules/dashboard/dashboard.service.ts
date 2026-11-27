import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthService } from '../../core/auth/auth.service';
import type { AuthContext } from '../../core/auth/auth.types';
import { ModuleRegistryService } from '../../core/modules/module-registry.service';
import { currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { today } from '../academic/academic-rules';
import { cellKey, TeachingService } from '../teaching/teaching.service';
import {
  assessmentProgress,
  type ClassProgress,
  pickTerm,
  type StatusCounts,
  studentFigures,
  type StudentFigures,
} from './dashboard-rules';

/**
 * The figures of the school dashboard. Every part is null when its module
 * is not active for the school or the user may not see it, so one call
 * serves the administrator, the exam officer and the teacher.
 */
export interface DashboardView {
  year: { id: string; name: string } | null;
  /** the term reported on; current: false between terms */
  term: { id: string; name: string; current: boolean } | null;
  students: (StudentFigures & { sections: number }) | null;
  staff: { active: number; teaching: number } | null;
  /** subject places (section x class subject) and how many have a teacher this year */
  teaching: { places: number; assigned: number } | null;
  /** assessments of the term; scope "mine": only the classes the user teaches */
  assessments: { scope: 'school' | 'mine'; overall: StatusCounts; byClass: ClassProgress[] } | null;
  /** sections whose results of the term are published */
  results: { sections: number; published: number } | null;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly modules: ModuleRegistryService,
    private readonly auth: AuthService,
    private readonly teaching: TeachingService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  async overview(actor: AuthContext): Promise<DashboardView> {
    const tenantId = currentTenantId();
    if (!tenantId) throw new BadRequestException({ code: 'SCHOOL_REQUIRED', message: 'This action needs a school.' });
    const [active, permissions] = await Promise.all([this.modules.activeModules(tenantId), this.auth.permissionsOf(actor.userId)]);
    const on = (...codes: string[]) => codes.every((c) => active.has(c));
    const may = (code: string) => permissions.has(code);

    const view: DashboardView = {
      year: null,
      term: null,
      students: null,
      staff: null,
      teaching: null,
      assessments: null,
      results: null,
    };

    const academic = on('academic') && may('academic.structure.view');
    const yearRow = await this.db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    const year = yearRow ? { id: yearRow.id, name: yearRow.name } : null;
    const [classes, sections] = await Promise.all([
      this.db.schoolClass.findMany({ select: { id: true, name: true, level: true } }),
      this.db.section.findMany({ select: { id: true, classId: true } }),
    ]);

    if (academic && year) {
      view.year = year;
      const terms = await this.db.term.findMany({
        where: { academicYearId: year.id },
        select: { id: true, name: true, startDate: true, endDate: true },
      });
      const picked = pickTerm(terms, today());
      if (picked) view.term = { id: picked.term.id, name: picked.term.name, current: picked.current };
    }

    if (on('student', 'enrollment') && may('student.record.view')) {
      const [students, enrolled] = await Promise.all([
        this.db.student.findMany({ where: { status: 'active' }, select: { id: true, gender: true } }),
        year
          ? this.db.enrollment.findMany({ where: { academicYearId: year.id, status: 'active' }, select: { studentId: true } })
          : [],
      ]);
      view.students = {
        ...studentFigures(students, new Set(enrolled.map((e) => e.studentId))),
        sections: sections.length,
      };
    }

    if (on('staff') && may('staff.record.view')) {
      const staff = await this.db.staffMember.findMany({ where: { status: 'active' }, select: { category: true } });
      view.staff = { active: staff.length, teaching: staff.filter((s) => s.category === 'teaching').length };
    }

    if (on('academic', 'staff') && may('academic.teacher.assign') && year) {
      const [classSubjects, assigned] = await Promise.all([
        this.db.classSubject.findMany({ select: { classId: true } }),
        this.db.teacherAssignment.count({ where: { academicYearId: year.id } }),
      ]);
      const subjectsPerClass = new Map<string, number>();
      for (const cs of classSubjects) subjectsPerClass.set(cs.classId, (subjectsPerClass.get(cs.classId) ?? 0) + 1);
      const places = sections.reduce((n, s) => n + (subjectsPerClass.get(s.classId) ?? 0), 0);
      view.teaching = { places, assigned };
    }

    if (on('assessment') && may('academic.structure.view') && view.term && year) {
      const rows = await this.db.assessment.findMany({
        where: { termId: view.term.id },
        select: { sectionId: true, subjectId: true, status: true },
      });
      const school = may('assessment.marks.validate');
      const mine = school ? null : await this.teaching.cellsOf(actor.userId, year.id);
      const visible = mine ? rows.filter((r) => mine.has(cellKey(r.sectionId, r.subjectId))) : rows;
      view.assessments = {
        scope: school ? 'school' : 'mine',
        ...assessmentProgress(visible, new Map(sections.map((s) => [s.id, s.classId])), classes),
      };
    }

    if (on('results') && may('results.compute') && view.term) {
      const published = await this.db.resultPublication.count({ where: { termId: view.term.id } });
      view.results = { sections: sections.length, published };
    }

    return view;
  }
}
