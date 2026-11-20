import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import {
  CreateStaffDto,
  LinkAccountDto,
  ListStaffQueryDto,
  SetStaffStatusDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';

const ip = (req: Request) => req.ip ?? null;
const VIEW = 'staff.record.view';
const EDIT = 'staff.record.edit';

/**
 * /api/staff — staff records of the current school.
 *   GET   /staff?search=&status=&category=     list (sorted by name)
 *   GET   /staff/accounts                      user accounts not yet linked to a staff record
 *   GET   /staff/:id                           one record
 *   POST  /staff                               create
 *   PATCH /staff/:id                           edit
 *   PATCH /staff/:id/status                    { status } active / inactive (has left)
 *   PUT   /staff/:id/account                   { userId | null } link or unlink a user account
 *
 * The whole controller belongs to the Staff module. Reading needs
 * staff.record.view; every change needs staff.record.edit.
 */
@RequireModule('staff')
@RequirePermission(VIEW)
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@Query() query: ListStaffQueryDto) {
    return this.staff.list(query);
  }

  @Get('accounts')
  @RequirePermission(EDIT)
  accounts() {
    return this.staff.linkableAccounts();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(id);
  }

  @Post()
  @RequirePermission(EDIT)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateStaffDto, @Req() req: Request) {
    return this.staff.create(auth, dto, ip(req));
  }

  @Patch(':id')
  @RequirePermission(EDIT)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @Req() req: Request,
  ) {
    return this.staff.update(auth, id, dto, ip(req));
  }

  @Patch(':id/status')
  @RequirePermission(EDIT)
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStaffStatusDto,
    @Req() req: Request,
  ) {
    return this.staff.setStatus(auth, id, dto.status, ip(req));
  }

  @Put(':id/account')
  @RequirePermission(EDIT)
  linkAccount(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkAccountDto,
    @Req() req: Request,
  ) {
    return this.staff.linkAccount(auth, id, dto.userId ?? null, ip(req));
  }
}
