import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { currentTenantId } from './tenant-context';
import { scopeArgs } from './tenant-scope';

function extend(prisma: PrismaService) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args, currentTenantId()) as typeof args);
        },
      },
    },
  });
}

export type TenantScopedClient = ReturnType<typeof extend>;

/**
 * THE database client for school data.
 *
 *   constructor(private readonly tdb: TenantPrismaService) {}
 *   this.tdb.db.role.findMany()   // only the current school's roles
 *
 * Business modules must use this client, never PrismaService directly.
 * PrismaService (unscoped) is reserved for platform/Super Admin code,
 * tenant resolution and seeding.
 */
@Injectable()
export class TenantPrismaService {
  private client?: TenantScopedClient;

  constructor(private readonly prisma: PrismaService) {}

  get db(): TenantScopedClient {
    // Created on first use (keeps tests that mock PrismaService simple).
    this.client ??= extend(this.prisma);
    return this.client;
  }
}
