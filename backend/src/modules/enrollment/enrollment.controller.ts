import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import { EnrollDto, EnrollmentQueryDto, TransferDto, WithdrawDto, YearQueryDto } from './dto/enrollment.dto';
import { EnrollmentService } from './enrollment.service';

const ip = (req: Request) => req.ip ?? null;

/**
 * /api/enrollment — students in sections, per academic year.
 *   GET  /enrollment?yearId=&sectionId=&status=   enrollments (default: current year)
 *   GET  /enrollment/sections?yearId=             every section with its number of students
 *   POST /enrollment                              { yearId?, sectionId, studentIds[], enrolledOn? }   (enrollment.enroll)
 *   POST /enrollment/:id/transfer                 { sectionId, on? }                                  (enrollment.enroll)
 *   POST /enrollment/:id/withdraw                 { on?, reason? }                                    (enrollment.withdraw)
 *
 * Needs the Enrollment and Student modules. Reading needs student.record.view.
 */
@RequireModule('enrollment', 'student')
@RequirePermission('student.record.view')
@Controller('enrollment')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Get()
  list(@Query() query: EnrollmentQueryDto) {
    return this.enrollment.list(query);
  }

  @Get('sections')
  sections(@Query() query: YearQueryDto) {
    return this.enrollment.sections(query.yearId);
  }

  @Post()
  @RequirePermission('enrollment.enroll')
  enroll(@CurrentAuth() auth: AuthContext, @Body() dto: EnrollDto, @Req() req: Request) {
    return this.enrollment.enroll(auth, dto, ip(req));
  }

  @Post(':id/transfer')
  @RequirePermission('enrollment.enroll')
  transfer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferDto,
    @Req() req: Request,
  ) {
    return this.enrollment.transfer(auth, id, dto, ip(req));
  }

  @Post(':id/withdraw')
  @RequirePermission('enrollment.withdraw')
  withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawDto,
    @Req() req: Request,
  ) {
    return this.enrollment.withdraw(auth, id, dto, ip(req));
  }
}
