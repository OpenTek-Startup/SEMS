import {
  ForbiddenException,
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';
import { isValidSlug, resolveTenantSlug } from './tenant-resolution';

/**
 * Resolves the school for every request and stores it in the tenant context.
 *  - no school named        -> continue without a school (health, platform routes)
 *  - unknown school         -> 404
 *  - suspended school       -> 403 (FR-PL-02)
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly allowHeader: boolean;

  constructor(
    private readonly directory: TenantDirectory,
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

    const tenant = isValidSlug(slug) ? await this.directory.bySlug(slug) : null;
    if (!tenant) {
      throw new NotFoundException(`Unknown school "${slug}"`);
    }
    if (tenant.status === 'suspended') {
      throw new ForbiddenException({
        code: 'SCHOOL_SUSPENDED',
        message: 'This school account is suspended. Contact OpenTek support.',
      });
    }

    runWithTenant(tenant, () => next());
  }
}
