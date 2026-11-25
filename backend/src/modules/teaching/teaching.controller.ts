import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import { AssignmentsQueryDto, SetAssignmentDto } from './dto/teaching.dto';
import { TeachingService } from './teaching.service';

const ip = (req: Request) => req.ip ?? null;
const VIEW = 'academic.structure.view';
const ASSIGN = 'academic.teacher.assign';

/**
 * /api/teaching — who teaches what, per academic year.
 *   GET /teaching/assignments?yearId=   sections x class subjects with their teachers (default: current year)
 *   GET /teaching/teachers?yearId=      active teaching staff with their number of classes
 *   PUT /teaching/assignments           { yearId?, sectionId, subjectId, staffMemberId | null } set or clear one teacher
 *   GET /teaching/mine                  the signed-in teacher's own classes this year
 *
 * Needs both the Academic and the Staff modules. Reading needs
 * academic.structure.view; assigning needs academic.teacher.assign.
 */
@RequireModule('academic', 'staff')
@RequirePermission(VIEW)
@Controller('teaching')
export class TeachingController {
  constructor(private readonly teaching: TeachingService) {}

  @Get('assignments')
  grid(@Query() query: AssignmentsQueryDto) {
    return this.teaching.grid(query.yearId);
  }

  @Get('teachers')
  @RequirePermission(ASSIGN)
  teachers(@Query() query: AssignmentsQueryDto) {
    return this.teaching.teachers(query.yearId);
  }

  @Put('assignments')
  @RequirePermission(ASSIGN)
  set(@CurrentAuth() auth: AuthContext, @Body() dto: SetAssignmentDto, @Req() req: Request) {
    return this.teaching.set(auth, dto, ip(req));
  }

  @Get('mine')
  mine(@CurrentAuth() auth: AuthContext) {
    return this.teaching.mine(auth);
  }
}
