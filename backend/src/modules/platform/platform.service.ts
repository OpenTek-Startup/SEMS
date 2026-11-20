import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuditService } from '../../core/audit/audit.service';
import { normalizeEmail } from '../../core/auth/auth-rules';
import type { AuthContext } from '../../core/auth/auth.types';
import { ModuleRegistryService, type SchoolModules } from '../../core/modules/module-registry.service';
import { BASE_ROLES, TEACHER_PERMISSIONS } from '../../core/tenancy/school-template';
import { TenantDirectory } from '../../core/tenancy/tenant-directory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { generateTemporaryPassword } from '../users/user-rules';
import type { CreateSchoolDto } from './dto/platform.dto';
import { checkSlug, cleanText, normalizeSlug, permissionIdsFor } from './platform-rules';

/** Returned once after creating a school: the first administrator's one-time password. */
export interface CreatedSchool {
  school: SchoolModules;
  admin: { email: string; firstName: string; lastName: string };
  temporaryPassword: string;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Super Admin actions on schools (FR-PL-01, FR-PL-02): create a school with
 * its base roles and first administrator; suspend or reactivate it.
 *
 * Platform code, so it uses the unscoped client and names the school in
 * every query, like the Module Registry.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    private readonly audit: AuditService,
    private readonly tenants: TenantDirectory,
  ) {}

  /**
   * Creates the school, its four base roles (Administrator gets every
   * permission, Staff / Teacher the teaching set) and its first
   * administrator, who must change the one-time password at first sign-in.
   * Only the core is on; the Super Admin then switches modules on.
   */
  async createSchool(actor: AuthContext, dto: CreateSchoolDto, ipAddress: string | null): Promise<CreatedSchool> {
    const slug = normalizeSlug(dto.slug);
    const problem = checkSlug(slug);
    if (problem) throw new BadRequestException(problem);

    const name = cleanText(dto.name);
    const admin = {
      email: normalizeEmail(dto.adminEmail),
      firstName: cleanText(dto.adminFirstName),
      lastName: cleanText(dto.adminLastName),
    };

    const taken = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (taken) throw this.slugTaken(slug);

    const catalogue = await this.prisma.permission.findMany({ select: { id: true, code: true } });
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hash(temporaryPassword);

    let created: { tenantId: string; adminId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { slug, name, type: dto.type }, select: { id: true } });

        const roleIds = new Map<string, string>();
        for (const r of BASE_ROLES) {
          const role = await tx.role.create({
            data: { tenantId: tenant.id, name: r.name, description: r.description, archetype: r.archetype, isSystem: true },
            select: { id: true },
          });
          roleIds.set(r.archetype, role.id);
        }

        const grants = [
          { roleId: roleIds.get('admin')!, ids: catalogue.map((p) => p.id) },
          { roleId: roleIds.get('staff')!, ids: permissionIdsFor(TEACHER_PERMISSIONS, catalogue) },
        ];
        for (const g of grants) {
          if (g.ids.length === 0) continue;
          await tx.rolePermission.createMany({
            data: g.ids.map((permissionId) => ({ roleId: g.roleId, permissionId, tenantId: tenant.id })),
          });
        }

        const user = await tx.user.create({
          data: { tenantId: tenant.id, ...admin, passwordHash, mustChangePassword: true },
          select: { id: true },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: roleIds.get('admin')!, tenantId: tenant.id } });

        return { tenantId: tenant.id, adminId: user.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.slugTaken(slug); // created by someone else a moment ago
      throw err;
    }

    // A lookup of this slug before it existed may be cached as "unknown school".
    this.tenants.invalidate(slug);

    await this.audit.record({
      action: 'tenant.created',
      tenantId: created.tenantId,
      actorUserId: actor.userId,
      entity: 'tenant',
      entityId: created.tenantId,
      detail: { slug, name, type: dto.type, adminEmail: admin.email },
      ipAddress,
    });

    return { school: await this.registry.school(created.tenantId), admin, temporaryPassword };
  }

  /**
   * FR-PL-02: a suspended school cannot be reached at all (403 on every
   * request naming it) and everyone signed in there is signed out.
   * Reactivating restores access; nothing is deleted.
   */
  async setStatus(
    actor: AuthContext,
    tenantId: string,
    status: 'active' | 'suspended',
    ipAddress: string | null,
  ): Promise<SchoolModules> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException({ code: 'SCHOOL_NOT_FOUND', message: 'No such school.' });
    if (tenant.status === status) return this.registry.school(tenantId);

    await this.prisma.tenant.update({ where: { id: tenantId }, data: { status } });
    if (status === 'suspended') {
      await this.prisma.session.updateMany({
        where: { tenantId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'school_suspended' },
      });
    }
    this.tenants.invalidate(tenant.slug);

    await this.audit.record({
      action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
      tenantId,
      actorUserId: actor.userId,
      entity: 'tenant',
      entityId: tenantId,
      detail: { slug: tenant.slug },
      ipAddress,
    });

    return this.registry.school(tenantId);
  }

  private slugTaken(slug: string) {
    return new ConflictException({ code: 'SLUG_TAKEN', message: `The school code "${slug}" is already used by another school.` });
  }
}
