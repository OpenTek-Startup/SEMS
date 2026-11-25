import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import { CreateStudentDto, ListStudentsQueryDto, SetStudentStatusDto, UpdateStudentDto } from './dto/student.dto';
import { StudentService } from './student.service';

const ip = (req: Request) => req.ip ?? null;
const VIEW = 'student.record.view';
const EDIT = 'student.record.edit';

/**
 * /api/students — student records of the current school.
 *   GET   /students?search=&status=&sectionId=&unplaced=true   list (sorted by name)
 *   GET   /students/:id                                       one record, with its enrollment history
 *   POST  /students                                           create
 *   PATCH /students/:id                                       edit
 *   PATCH /students/:id/status                                { status } active / inactive (has left)
 *
 * Reading needs student.record.view; every change needs student.record.edit.
 */
@RequireModule('student')
@RequirePermission(VIEW)
@Controller('students')
export class StudentController {
  constructor(private readonly students: StudentService) {}

  @Get()
  list(@Query() query: ListStudentsQueryDto) {
    return this.students.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.get(id);
  }

  @Post()
  @RequirePermission(EDIT)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateStudentDto, @Req() req: Request) {
    return this.students.create(auth, dto, ip(req));
  }

  @Patch(':id')
  @RequirePermission(EDIT)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @Req() req: Request,
  ) {
    return this.students.update(auth, id, dto, ip(req));
  }

  @Patch(':id/status')
  @RequirePermission(EDIT)
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStudentStatusDto,
    @Req() req: Request,
  ) {
    return this.students.setStatus(auth, id, dto.status, ip(req));
  }
}
