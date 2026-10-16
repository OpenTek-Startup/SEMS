import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, SuperAdminOnly } from '../../core/auth/decorators';
import { ModuleRegistryService } from '../../core/modules/module-registry.service';

export class SetModuleActiveDto {
  @IsBoolean({ message: 'active must be true or false.' })
  active: boolean;
}

/**
 * /api/platform — the Super Admin console (no school in the request).
 *   GET /platform/modules                          catalogue with dependencies
 *   GET /platform/schools                          every school with its active modules
 *   PUT /platform/schools/:id/modules/:code        { active } switch a module on/off
 */
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly registry: ModuleRegistryService) {}

  @Get('modules')
  modules() {
    return this.registry.catalogue();
  }

  @Get('schools')
  schools() {
    return this.registry.schools();
  }

  @Put('schools/:id/modules/:code')
  setModule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('code') code: string,
    @Body() dto: SetModuleActiveDto,
    @Req() req: Request,
  ) {
    return this.registry.setActive(auth.userId, tenantId, code, dto.active, req.ip ?? null);
  }
}
