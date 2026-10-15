import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { AuditFilterError, buildAuditWhere, fullName, pageOf, type AuditFilter } from './audit-rules';

export interface AuditPerson {
  id: string;
  name: string;
  email: string;
}

export interface AuditItem {
  id: string;
  action: string;
  createdAt: Date;
  ipAddress: string | null;
  /** Who did it (null for an unknown email or the system). */
  actor: AuditPerson | null;
  entity: string | null;
  entityId: string | null;
  /** The user the action was about, when entity = "user". */
  target: AuditPerson | null;
  detail: unknown;
}

export interface AuditPage {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
}

const PERSON_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;

interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Reads the audit log of the CURRENT school only (FR-PL-06): the
 * school-scoped client adds tenant_id to every query, so platform events
 * and other schools' events are never returned. Newest first.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly tdb: TenantPrismaService) {}

  async list(filter: AuditFilter): Promise<AuditPage> {
    if (!currentTenantId()) {
      throw new BadRequestException({ code: 'SCHOOL_REQUIRED', message: 'The audit log needs a school.' });
    }

    let where: Prisma.AuditLogWhereInput;
    try {
      where = buildAuditWhere(filter) as Prisma.AuditLogWhereInput;
    } catch (err) {
      if (err instanceof AuditFilterError) {
        throw new BadRequestException({ code: 'INVALID_FILTER', message: err.message });
      }
      throw err;
    }
    const { page, pageSize, skip, take } = pageOf(filter.page, filter.pageSize);

    const [rows, total] = await Promise.all([
      this.tdb.db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          action: true,
          createdAt: true,
          ipAddress: true,
          entity: true,
          entityId: true,
          detail: true,
          actor: { select: PERSON_SELECT },
        },
      }),
      this.tdb.db.auditLog.count({ where }),
    ]);

    // Names of the users the entries are about, in one query.
    const targetIds = [
      ...new Set(rows.filter((r) => r.entity === 'user' && r.entityId).map((r) => r.entityId as string)),
    ];
    const targets: PersonRow[] =
      targetIds.length > 0
        ? await this.tdb.db.user.findMany({ where: { id: { in: targetIds } }, select: PERSON_SELECT })
        : [];
    const targetById = new Map<string, PersonRow>(targets.map((t) => [t.id, t]));

    const person = (p: PersonRow | null | undefined): AuditPerson | null =>
      p ? { id: p.id, name: fullName(p), email: p.email } : null;

    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        createdAt: r.createdAt,
        ipAddress: r.ipAddress,
        actor: person(r.actor),
        entity: r.entity,
        entityId: r.entityId,
        target: r.entity === 'user' && r.entityId ? person(targetById.get(r.entityId)) : null,
        detail: r.detail,
      })),
      page,
      pageSize,
      total,
    };
  }
}
