import {
  ForbiddenException,
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithTenant, type TenantInfo } from './tenant-context';
import { isValidSlug, resolveTenantSlug } from './tenant-resolution';

const CACHE_TTL_MS = 30_000;

/**
 * Resolves the school for every request and stores it in the tenant context.
 *  - no school named        -> continue without a school (health, platform routes)
 *  - unknown school         -> 404
 *  - suspended school       -> 403 (FR-PL-02)
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly cache = new Map<string, { tenant: TenantInfo | null; expires: number }>();
  private readonly allowHeader: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.allowHeader = config.get<string>('nodeEnv') !== 'production';
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug = resolveTenantSlug({
      headerValue: req.headers['x-tenant'],
      host: req.headers.host,
      allowHeader: this.allowHeader,
    });

    if (!slug) return next();

    const tenant = isValidSlug(slug) ? await this.lookup(slug) : null;
    if (!tenant) {
      throw new NotFoundException(`Unknown school "${slug}"`);
    }
    if (tenant.status === 'suspended') {
      throw new ForbiddenException('This school account is suspended. Contact OpenTek support.');
    }

    runWithTenant(tenant, () => next());
  }

  /** Drop a cached entry, e.g. right after suspending or renaming a school. */
  invalidate(slug: string) {
    this.cache.delete(slug);
  }

  private async lookup(slug: string): Promise<TenantInfo | null> {
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
}
