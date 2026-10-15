import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken, missingPermissions } from './auth-rules';
import { forbidden, unauthorized } from './auth.errors';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';

/**
 * Global guard (registered in AuthModule), in order:
 *  1. @Public() routes pass.
 *  2. A valid access token for THIS school is required (401 otherwise).
 *  3. A pending password change blocks everything but /auth/me and
 *     /auth/change-password (403 PASSWORD_CHANGE_REQUIRED).
 *  4. @RequirePermission(...) codes must all be granted by the user's
 *     roles (403 PERMISSION_DENIED). Permissions are read fresh on each
 *     request, so a role change applies immediately.
 * Runs after TenantMiddleware, so the request's school is already known.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
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
