import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';

/** Read side of the audit log. Writing stays in core/audit (AuditService). */
@Module({
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditViewerModule {}
