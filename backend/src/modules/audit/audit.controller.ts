import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../core/auth/decorators';
import { AuditQueryService } from './audit-query.service';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * /api/audit — who did what, when, in this school (FR-PL-06, FR-ID-09).
 *
 *   GET /api/audit?action=user.&from=2026-10-01&to=2026-10-15&page=1&pageSize=25
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('core.audit.view')
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
