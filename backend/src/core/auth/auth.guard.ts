import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken, missingPermissions } from './auth-rules';
import { forbidden, unauthorized } from './auth.errors';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { ModuleRegistryService } from '../modules/module-registry.service';
import {
  ALLOW_PENDING_PASSWORD_CHANGE,
  IS_PUBLIC,
  REQUIRED_MODULES,
  REQUIRED_PERMISSIONS,
  SUPER_ADMIN_ONLY,
} from './decorators';

/**
 * Global guard (registered in AuthModule), in order:
 *  1. @Public() routes pass.
 *  2. A valid access token for THIS school is required (401 otherwise).
 *  3. A pending password change blocks everything but /auth/me and
 *     /auth/change-password (403 PASSWORD_CHANGE_REQUIRED).
 *  4. @SuperAdminOnly() routes need the platform Super Admin, with no school.
 *  5. @RequireModule(...) modules must be active for the school
 *     (403 MODULE_INACTIVE).
 *  6. @RequirePermission(...) codes must all be granted by the user's
 *     roles (403 PERMISSION_DENIED). Permissions are read fresh on each
 *     request, so a role change applies immediately; permissions of an
 *     inactive module never count.
 * Runs after TenantMiddleware, so the request's school is already known.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly registry: ModuleRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) throw unauthorized('NOT_SIGNED_IN', 'You are not signed in.');

    const auth = await this.auth.authenticate(token);

    const allowPending = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_PASSWORD_CHANGE,
      targets,
    );
    if (auth.mustChangePassword && !allowPending) {
      throw forbidden('PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
    }

    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, targets)) {
      if (!auth.isSuperAdmin || auth.tenantId !== null) {
        throw forbidden('SUPER_ADMIN_ONLY', 'Only the platform Super Admin can do this.');
      }
    }

    const modules = this.reflector.getAllAndOverride<string[]>(REQUIRED_MODULES, targets);
    if (modules && modules.length > 0) {
      const active = auth.tenantId ? await this.registry.activeModules(auth.tenantId) : new Set<string>();
      const inactive = modules.filter((code) => !active.has(code));
      if (inactive.length > 0) {
        throw forbidden(
          'MODULE_INACTIVE',
          `This part of YESE is not active for your school (${inactive.join(', ')}).`,
        );
      }
    }

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets);
    if (required && required.length > 0) {
      const missing = missingPermissions(required, await this.auth.permissionsOf(auth.userId));
      if (missing.length > 0) {
        throw forbidden(
          'PERMISSION_DENIED',
          `You do not have permission to do this (needs ${missing.join(', ')}).`,
        );
      }
    }

    request.auth = auth;
    return true;
  }
}
