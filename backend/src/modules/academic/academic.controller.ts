import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import { AcademicService } from './academic.service';
import {
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

const ip = (req: Request) => req.ip ?? null;
const VIEW = 'academic.structure.view';
const MANAGE = 'academic.structure.manage';

/**
 * /api/academic — years and terms, classes and sections, subjects.
 *
 * The whole controller belongs to the Academic module (403 MODULE_INACTIVE
 * when the school has not switched it on). Reading needs
 * academic.structure.view; every change needs academic.structure.manage.
 */
@RequireModule('academic')
@RequirePermission(VIEW)
@Controller('academic')
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  // ------------------------------------------------------------ years

  @Get('current')
  current() {
    return this.academic.current();
  }

  @Get('years')
  years() {
    return this.academic.years();
  }

  @Post('years')
  @RequirePermission(MANAGE)
  createYear(@CurrentAuth() auth: AuthContext, @Body() dto: CreateYearDto, @Req() req: Request) {
    return this.academic.createYear(auth, dto, ip(req));
  }

  @Patch('years/:id')
  @RequirePermission(MANAGE)
  updateYear(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateYearDto,
    @Req() req: Request,
  ) {
    return this.academic.updateYear(auth, id, dto, ip(req));
  }

  @Post('years/:id/current')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(MANAGE)
  setCurrentYear(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.academic.setCurrentYear(auth, id, ip(req));
  }

  @Delete('years/:id')
  @RequirePermission(MANAGE)
  deleteYear(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.academic.deleteYear(auth, id, ip(req));
  }

  @Post('years/:id/terms')
  @RequirePermission(MANAGE)
  createTerm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) yearId: string,
    @Body() dto: CreateTermDto,
    @Req() req: Request,
  ) {
    return this.academic.createTerm(auth, yearId, dto, ip(req));
  }

  @Patch('terms/:id')
  @RequirePermission(MANAGE)
  updateTerm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTermDto,
    @Req() req: Request,
  ) {
    return this.academic.updateTerm(auth, id, dto, ip(req));
  }

  @Delete('terms/:id')
  @RequirePermission(MANAGE)
  deleteTerm(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.academic.deleteTerm(auth, id, ip(req));
  }

  // -------------------------------------------------- classes and sections

  @Get('classes')
  classes() {
    return this.academic.classes();
  }

  @Post('classes')
  @RequirePermission(MANAGE)
  createClass(@CurrentAuth() auth: AuthContext, @Body() dto: CreateClassDto, @Req() req: Request) {
    return this.academic.createClass(auth, dto, ip(req));
  }

  @Patch('classes/:id')
  @RequirePermission(MANAGE)
  updateClass(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @Req() req: Request,
  ) {
    return this.academic.updateClass(auth, id, dto, ip(req));
  }

  @Delete('classes/:id')
  @RequirePermission(MANAGE)
  deleteClass(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.academic.deleteClass(auth, id, ip(req));
  }

  @Put('classes/:id/subjects')
  @RequirePermission(MANAGE)
  setClassSubjects(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetClassSubjectsDto,
    @Req() req: Request,
  ) {
    return this.academic.setClassSubjects(auth, id, dto, ip(req));
  }

  @Post('classes/:id/sections')
  @RequirePermission(MANAGE)
  createSection(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: CreateSectionDto,
    @Req() req: Request,
  ) {
    return this.academic.createSection(auth, classId, dto, ip(req));
  }

  @Get('sections')
  sections() {
    return this.academic.sections();
  }

  @Patch('sections/:id')
  @RequirePermission(MANAGE)
  updateSection(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSectionDto,
    @Req() req: Request,
  ) {
    return this.academic.updateSection(auth, id, dto, ip(req));
  }

  @Delete('sections/:id')
  @RequirePermission(MANAGE)
  deleteSection(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.academic.deleteSection(auth, id, ip(req));
  }

  // ---------------------------------------------------------- subjects

  @Get('subjects')
  subjects() {
    return this.academic.subjects();
  }

  @Post('subjects')
  @RequirePermission(MANAGE)
  createSubject(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSubjectDto, @Req() req: Request) {
    return this.academic.createSubject(auth, dto, ip(req));
  }

  @Patch('subjects/:id')
  @RequirePermission(MANAGE)
  updateSubject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
    @Req() req: Request,
  ) {
    return this.academic.updateSubject(auth, id, dto, ip(req));
  }

  @Delete('subjects/:id')
  @RequirePermission(MANAGE)
  deleteSubject(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.academic.deleteSubject(auth, id, ip(req));
  }
}
