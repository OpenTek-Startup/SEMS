import {
  Body,
  Controller,
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
import { CurrentAuth, RequirePermission } from '../../core/auth/decorators';
import { CreateUserDto, SetUserRolesDto, SetUserStatusDto } from './dto/users.dto';
import { UsersService } from './users.service';

const ip = (req: Request) => req.ip ?? null;

/**
 * /api/users — user administration inside the current school.
 * Each route names the permission it needs; AuthGuard checks it.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('core.user.view')
  list() {
    return this.users.list();
  }

  @Post()
  @RequirePermission('core.user.manage')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateUserDto, @Req() req: Request) {
    return this.users.create(auth, dto, ip(req));
  }

  @Patch(':id/status')
  @RequirePermission('core.user.manage')
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
    @Req() req: Request,
  ) {
    return this.users.setStatus(auth, id, dto.status, ip(req));
  }

  @Put(':id/roles')
  @RequirePermission('core.role.manage')
  setRoles(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @Req() req: Request,
  ) {
    return this.users.setRoles(auth, id, dto.roleIds, ip(req));
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('core.user.manage')
  resetPassword(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.users.resetPassword(auth, id, ip(req));
  }
}

/** /api/roles — the school's roles, for the role picker. */
@Controller('roles')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('core.user.view')
  list() {
    return this.users.roles();
  }
}
