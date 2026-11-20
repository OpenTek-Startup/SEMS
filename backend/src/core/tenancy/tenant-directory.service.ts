import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantInfo } from './tenant-context';

const CACHE_TTL_MS = 30_000;

/**
 * Looks up a school by its slug, with a short cache (every request does it).
 *
 * Kept apart from TenantMiddleware on purpose: Nest builds its own instance
 * of a middleware class, so a cache inside the middleware could not be
 * cleared by other services. This provider is a single shared instance,
 * used by the middleware and by the Super Admin actions that change a school.
 */
@Injectable()
export class TenantDirectory {
  private readonly cache = new Map<string, { tenant: TenantInfo | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async bySlug(slug: string): Promise<TenantInfo | null> {
    const hit = this.cache.get(slug);
    if (hit && hit.expires > Date.now()) return hit.tenant;

    const row = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, type: true, status: true },
    });
    const tenant: TenantInfo | null = row ?? null;
    this.cache.set(slug, { tenant, expires: Date.now() + CACHE_TTL_MS });
    return tenant;
  }

  /** Drop a cached entry, e.g. right after creating, suspending or renaming a school. */
  invalidate(slug: string): void {
    this.cache.delete(slug);
  }

  /** Forget everything (tests). */
  invalidateAll(): void {
    this.cache.clear();
  }
}
