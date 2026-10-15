import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { normalizeEmail } from '../../core/auth/auth-rules';
import type { AuthContext } from '../../core/auth/auth.types';
import { currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import {
  byName,
  generateTemporaryPassword,
  toUserListItem,
  uniqueIds,
  type UserListItem,
} from './user-rules';

const USER_LIST_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, name: true, archetype: true } } } },
} satisfies Prisma.UserSelect;

export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  archetype: string | null;
  isSystem: boolean;
  permissions: string[];
}

/** Result of creating a user or resetting a password: shown ONCE to the admin. */
export interface UserWithTemporaryPassword {
  user: UserListItem;
  temporaryPassword: string;
}

function apiError(
  Kind: typeof BadRequestException | typeof NotFoundException | typeof ConflictException,
  code: string,
  message: string,
) {
  return new Kind({ code, message });
}

/**
 * School user administration (FR-ID-02, FR-ID-04, FR-ID-05).
 *
 * Everything goes through the school-scoped client (TenantPrismaService):
 * a user id from another school is simply "not found", it can never be
 * read or changed from here. tenantId is still written explicitly on
 * creates; the scoped client checks that it is the current school.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<UserListItem[]> {
    this.requireSchool();
    const rows = await this.tdb.db.user.findMany({ select: USER_LIST_SELECT });
    return rows.map(toUserListItem).sort(byName);
  }

  async roles(): Promise<RoleListItem[]> {
    this.requireSchool();
    const rows = await this.tdb.db.role.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        archetype: true,
        isSystem: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        archetype: r.archetype,
        isSystem: r.isSystem,
        permissions: r.permissions.map((p) => p.permission.code).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(
    actor: AuthContext,
    input: { email: string; firstName: string; lastName: string; roleIds: string[] },
    ipAddress: string | null,
  ): Promise<UserWithTemporaryPassword> {
    const tenantId = this.requireSchool();
    const email = normalizeEmail(input.email);
    const roleIds = uniqueIds(input.roleIds);

    const existing = await this.tdb.db.user.findFirst({ where: { email }, select: { id: true } });
    if (existing) {
      throw apiError(ConflictException, 'EMAIL_TAKEN', 'A user with this email already exists in your school.');
    }
    await this.assertRolesExist(roleIds);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hash(temporaryPassword);

    const userId = await this.tdb.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          passwordHash,
          mustChangePassword: true,
        },
        select: { id: true },
      });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: user.id, roleId, tenantId })),
        });
      }
      return user.id;
    });

    await this.audit.record({
      action: 'user.created',
      tenantId,
      actorUserId: actor.userId,
      entity: 'user',
      entityId: userId,
      detail: { email, roleIds },
      ipAddress,
    });

    return { user: await this.get(userId), temporaryPassword };
  }

  async setStatus(
    actor: AuthContext,
    userId: string,
    status: 'active' | 'disabled',
    ipAddress: string | null,
  ): Promise<UserListItem> {
    const tenantId = this.requireSchool();
    this.refuseSelf(actor, userId, 'You cannot disable or enable your own account.');
    await this.get(userId);

    await this.tdb.db.user.update({ where: { id: userId }, data: { status } });
    if (status === 'disabled') {
      // Sign the user out everywhere, now.
      await this.tdb.db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'account_disabled' },
      });
    }

    await this.audit.record({
      action: status === 'disabled' ? 'user.disabled' : 'user.enabled',
      tenantId,
      actorUserId: actor.userId,
      entity: 'user',
      entityId: userId,
      ipAddress,
    });
    return this.get(userId);
  }

  async setRoles(
    actor: AuthContext,
    userId: string,
    roleIdsInput: string[],
    ipAddress: string | null,
  ): Promise<UserListItem> {
    const tenantId = this.requireSchool();
    this.refuseSelf(actor, userId, 'You cannot change your own roles. Ask another administrator.');
    const before = await this.get(userId);
    const roleIds = uniqueIds(roleIdsInput);
    await this.assertRolesExist(roleIds);

    await this.tdb.db.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId, tenantId })) });
      }
    });

    await this.audit.record({
      action: 'user.roles.updated',
      tenantId,
      actorUserId: actor.userId,
      entity: 'user',
      entityId: userId,
      detail: { before: before.roles.map((r) => r.id), after: roleIds },
      ipAddress,
    });
    return this.get(userId);
  }

  /** FR-ID-02: an administrator resets a password; the user must change it at next sign-in. */
  async resetPassword(
    actor: AuthContext,
    userId: string,
    ipAddress: string | null,
  ): Promise<UserWithTemporaryPassword> {
    const tenantId = this.requireSchool();
    this.refuseSelf(actor, userId, 'Use "Change password" for your own account.');
    await this.get(userId);

    const temporaryPassword = generateTemporaryPassword();
    await this.tdb.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(temporaryPassword), mustChangePassword: true },
    });
    // Whoever is signed in with the old password is signed out.
    await this.tdb.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_reset' },
    });

    await this.audit.record({
      action: 'user.password.reset',
      tenantId,
      actorUserId: actor.userId,
      entity: 'user',
      entityId: userId,
      ipAddress,
    });
    return { user: await this.get(userId), temporaryPassword };
  }

  // ------------------------------------------------------------- helpers

  private async get(userId: string): Promise<UserListItem> {
    const row = await this.tdb.db.user.findFirst({ where: { id: userId }, select: USER_LIST_SELECT });
    if (!row) throw apiError(NotFoundException, 'USER_NOT_FOUND', 'This user does not exist in your school.');
    return toUserListItem(row);
  }

  /** Every role id must be a role of THIS school (the scoped client hides the others). */
  private async assertRolesExist(roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const found = await this.tdb.db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
    if (found.length !== roleIds.length) {
      throw apiError(BadRequestException, 'UNKNOWN_ROLE', 'One or more roles do not exist in your school.');
    }
  }

  /** Administrators cannot lock themselves out by mistake. */
  private refuseSelf(actor: AuthContext, userId: string, message: string): void {
    if (actor.userId === userId) throw apiError(BadRequestException, 'CANNOT_CHANGE_SELF', message);
  }

  private requireSchool(): string {
    const tenantId = currentTenantId();
    if (!tenantId) {
      throw apiError(BadRequestException, 'SCHOOL_REQUIRED', 'This action needs a school.');
    }
    return tenantId;
  }
}
