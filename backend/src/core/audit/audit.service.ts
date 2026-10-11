import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  /** e.g. "auth.login.success", "auth.login.failed", "auth.password.changed" */
  action: string;
  /** null for platform-level events (Super Admin, no school) */
  tenantId?: string | null;
  actorUserId?: string | null;
  entity?: string;
  entityId?: string | null;
  detail?: Prisma.InputJsonObject;
  ipAddress?: string | null;
}

/**
 * Append-only audit trail (FR-PL-06, FR-ID-09).
 *
 * Writes through the unscoped client because some events have no school
 * (Super Admin) or happen before a user is known (failed sign-in).
 * A failed audit write is logged but never breaks the user's request.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          tenantId: entry.tenantId ?? null,
          actorUserId: entry.actorUserId ?? null,
          entity: entry.entity ?? null,
          entityId: entry.entityId ?? null,
          detail: entry.detail,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Could not write audit entry "${entry.action}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
