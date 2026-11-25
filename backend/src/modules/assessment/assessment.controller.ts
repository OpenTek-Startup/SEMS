import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import { CreateAssessmentDto, ListAssessmentsQueryDto, SaveMarksDto, UpdateAssessmentDto } from './dto/assessment.dto';
import { AssessmentService } from './assessment.service';

const ip = (req: Request) => req.ip ?? null;
const VIEW = 'academic.structure.view';

/**
 * /api/assessments — tests, sequences and exams, and their workflow.
 *   GET    /assessments?yearId=&termId=&sectionId=&subjectId=&status=   list (teachers: their own classes)
 *   GET    /assessments/:id
 *   POST   /assessments                  create        (assessment.create, own class)
 *   PATCH  /assessments/:id              edit, open    (assessment.create, own class)
 *   DELETE /assessments/:id              delete, open  (assessment.create, own class)
 *   POST   /assessments/:id/submit       open -> submitted         (assessment.marks.enter, own class)
 *   POST   /assessments/:id/validate     submitted -> validated    (assessment.marks.validate)
 *   POST   /assessments/:id/reopen       back to open              (assessment.marks.validate)
 *   POST   /assessments/:id/lock         validated -> locked       (assessment.marks.lock)
 *   GET    /assessments/:id/marks        the mark sheet (own class)
 *   PUT    /assessments/:id/marks        { marks: [{ studentId, value }], reason? }
 *          open: assessment.marks.enter, own class; locked: assessment.marks.override + reason
 *
 * "Own class": the teacher assigned to the subject in the section (Teaching
 * module). Holders of assessment.marks.validate work on every class.
 */
@RequireModule('assessment')
@RequirePermission(VIEW)
@Controller('assessments')
export class AssessmentController {
  constructor(private readonly assessments: AssessmentService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListAssessmentsQueryDto) {
    return this.assessments.list(auth, query);
  }

  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.get(auth, id);
  }

  @Post()
  @RequirePermission('assessment.create')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAssessmentDto, @Req() req: Request) {
    return this.assessments.create(auth, dto, ip(req));
  }

  @Patch(':id')
  @RequirePermission('assessment.create')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssessmentDto,
    @Req() req: Request,
  ) {
    return this.assessments.update(auth, id, dto, ip(req));
  }

  @Delete(':id')
  @RequirePermission('assessment.create')
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assessments.remove(auth, id, ip(req));
  }

  @Get(':id/marks')
  marks(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.marks(auth, id);
  }

  /** Who may save depends on the status (checked in the service). */
  @Put(':id/marks')
  saveMarks(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMarksDto,
    @Req() req: Request,
  ) {
    return this.assessments.saveMarks(auth, id, dto, ip(req));
  }

  @Post(':id/submit')
  @RequirePermission('assessment.marks.enter')
  submit(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assessments.transition(auth, id, 'submit', ip(req));
  }

  @Post(':id/validate')
  @RequirePermission('assessment.marks.validate')
  validate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assessments.transition(auth, id, 'validate', ip(req));
  }

  @Post(':id/reopen')
  @RequirePermission('assessment.marks.validate')
  reopen(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assessments.transition(auth, id, 'reopen', ip(req));
  }

  @Post(':id/lock')
  @RequirePermission('assessment.marks.lock')
  lock(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assessments.transition(auth, id, 'lock', ip(req));
  }
}
