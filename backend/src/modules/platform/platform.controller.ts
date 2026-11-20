import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, SuperAdminOnly } from '../../core/auth/decorators';
import { ModuleRegistryService } from '../../core/modules/module-registry.service';
import { CreateSchoolDto, SetModuleActiveDto, SetSchoolStatusDto } from './dto/platform.dto';
import { PlatformService } from './platform.service';

const ip = (req: Request) => req.ip ?? null;

/**
 * /api/platform — the Super Admin console (no school in the request).
 *   GET   /platform/modules                       catalogue with dependencies
 *   GET   /platform/schools                       every school with its active modules
 *   POST  /platform/schools                       create a school and its first administrator
 *   PATCH /platform/schools/:id/status            { status } suspend or reactivate a school
 *   PUT   /platform/schools/:id/modules/:code     { active } switch a module on/off
 */
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly platform: PlatformService,
  ) {}

  @Get('modules')
  modules() {
    return this.registry.catalogue();
  }

  @Get('schools')
  schools() {
    return this.registry.schools();
  }

  @Post('schools')
  createSchool(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSchoolDto, @Req() req: Request) {
    return this.platform.createSchool(auth, dto, ip(req));
  }

  @Patch('schools/:id/status')
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body() dto: SetSchoolStatusDto,
    @Req() req: Request,
  ) {
    return this.platform.setStatus(auth, tenantId, dto.status, ip(req));
  }

  @Put('schools/:id/modules/:code')
  setModule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('code') code: string,
    @Body() dto: SetModuleActiveDto,
    @Req() req: Request,
  ) {
    return this.registry.setActive(auth.userId, tenantId, code, dto.active, ip(req));
  }
}
