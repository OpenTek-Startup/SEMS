import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  activeDependents,
  activeSet,
  type CatalogueModule,
  isCore,
  missingDependencies,
  moduleNames,
} from './module-rules';

const CATALOGUE_TTL_MS = 60_000;
const ACTIVE_TTL_MS = 30_000;

export interface SchoolModules {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  /** codes of the active modules, core included */
  activeModules: string[];
}

/**
 * Module Registry (FR-PL-03): which modules exist, what they depend on, and
 * which ones each school has switched on.
 *
 * Core infrastructure, so it uses the unscoped client: the Super Admin works
 * across schools, and every query below names its school explicitly.
 * Results are cached briefly; a change made here clears the cache at once.
 */
@Injectable()
export class ModuleRegistryService {
  private catalogueCache?: { rows: CatalogueModule[]; expires: number };
  private readonly activeCache = new Map<string, { codes: Set<string>; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async catalogue(): Promise<CatalogueModule[]> {
    if (this.catalogueCache && this.catalogueCache.expires > Date.now()) return this.catalogueCache.rows;
    const rows = await this.prisma.module.findMany({
      select: { code: true, name: true, category: true, description: true, dependsOn: true },
      orderBy: { code: 'asc' },
    });
    this.catalogueCache = { rows, expires: Date.now() + CATALOGUE_TTL_MS };
    return rows;
  }

  /** Active module codes of a school (core always included). */
  async activeModules(tenantId: string): Promise<Set<string>> {
    const hit = this.activeCache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.codes;
    const [catalogue, rows] = await Promise.all([
      this.catalogue(),
      this.prisma.tenantModule.findMany({
        where: { tenantId, active: true },
        select: { moduleCode: true },
      }),
    ]);
    const codes = activeSet(catalogue, rows.map((r) => r.moduleCode));
    this.activeCache.set(tenantId, { codes, expires: Date.now() + ACTIVE_TTL_MS });
    return codes;
  }

  async isActive(tenantId: string, code: string): Promise<boolean> {
    return (await this.activeModules(tenantId)).has(code);
  }

  /** Super Admin: every school with its active modules. */
  async schools(): Promise<SchoolModules[]> {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, slug: true, name: true, type: true, status: true },
      orderBy: { name: 'asc' },
    });
    return Promise.all(tenants.map((t) => this.schoolView(t)));
  }

  /**
   * Super Admin switches a module on or off for one school.
   *  - core modules cannot be switched off
   *  - switching on needs every dependency to be on
   *  - switching off is refused while an active module depends on it
   */
  async setActive(
    actorUserId: string,
    tenantId: string,
    code: string,
    active: boolean,
    ipAddress: string | null,
  ): Promise<SchoolModules> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, type: true, status: true },
    });
    if (!tenant) throw new NotFoundException({ code: 'SCHOOL_NOT_FOUND', message: 'No such school.' });

    const catalogue = await this.catalogue();
    const module = catalogue.find((m) => m.code === code);
    if (!module) throw new NotFoundException({ code: 'MODULE_NOT_FOUND', message: `No module "${code}".` });
    if (isCore(module)) {
      throw new BadRequestException({ code: 'MODULE_CORE', message: `${module.name} is part of the core and is always on.` });
    }

    this.invalidate(tenantId);
    const current = await this.activeModules(tenantId);
    if (current.has(code) === active) return this.schoolView(tenant); // nothing to change

    if (active) {
      const missing = missingDependencies(code, catalogue, current);
      if (missing.length > 0) {
        throw new ConflictException({
          code: 'MODULE_DEPENDENCY_INACTIVE',
          message: `${module.name} needs ${moduleNames(missing, catalogue)}. Activate ${missing.length === 1 ? 'it' : 'them'} first.`,
          missing,
        });
      }
    } else {
      const dependents = activeDependents(code, catalogue, current);
      if (dependents.length > 0) {
        throw new ConflictException({
          code: 'MODULE_REQUIRED_BY',
          message: `${moduleNames(dependents, catalogue)} still ${dependents.length === 1 ? 'needs' : 'need'} ${module.name}. Deactivate ${dependents.length === 1 ? 'it' : 'them'} first.`,
          dependents,
        });
      }
    }

    await this.prisma.tenantModule.upsert({
      where: { tenantId_moduleCode: { tenantId, moduleCode: code } },
      update: { active, changedById: actorUserId },
      create: { tenantId, moduleCode: code, active, changedById: actorUserId },
    });
    this.invalidate(tenantId);

    await this.audit.record({
      action: active ? 'module.activated' : 'module.deactivated',
      tenantId,
      actorUserId,
      entity: 'module',
      detail: { module: code },
      ipAddress,
    });

    return this.schoolView(tenant);
  }

  /** Forget cached activations of one school (after a change). */
  invalidate(tenantId: string): void {
    this.activeCache.delete(tenantId);
  }

  /** Forget everything (tests, or after reseeding). */
  invalidateAll(): void {
    this.activeCache.clear();
    this.catalogueCache = undefined;
  }

  private async schoolView(t: {
    id: string;
    slug: string;
    name: string;
    type: string;
    status: string;
  }): Promise<SchoolModules> {
    const active = await this.activeModules(t.id);
    return { ...t, activeModules: [...active].sort((a, b) => a.localeCompare(b)) };
  }
}
