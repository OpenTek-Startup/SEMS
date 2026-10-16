import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from './auth.types';
import { unauthorized } from './auth.errors';

export const IS_PUBLIC = 'auth:public';
export const ALLOW_PENDING_PASSWORD_CHANGE = 'auth:allow-pending-password-change';
export const REQUIRED_PERMISSIONS = 'auth:required-permissions';
export const REQUIRED_MODULES = 'auth:required-modules';
export const SUPER_ADMIN_ONLY = 'auth:super-admin-only';

/**
 * Every route requires a signed-in user by default (global AuthGuard).
 * Mark the few open routes explicitly: health, tenant lookup, login, refresh, logout.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Routes a user may call while their password must still be changed
 * (seeded or reset accounts): /auth/me and /auth/change-password.
 */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

/**
 * The caller needs EVERY listed permission (codes from the seeded catalogue,
 * module.resource.action). Checked by AuthGuard on every request (FR-ID-06).
 *
 *   @RequirePermission('core.user.manage')
 */
export const RequirePermission = (...codes: [string, ...string[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, codes);

/**
 * The route belongs to a module that must be active for the caller's
 * school (Module Registry, FR-PL-03). Inactive -> 403 MODULE_INACTIVE.
 *
 *   @RequireModule('student')
 */
export const RequireModule = (...codes: [string, ...string[]]) => SetMetadata(REQUIRED_MODULES, codes);

/** Platform routes: only the Super Admin, signed in with no school. */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/** Injects the caller's AuthContext into a controller method. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw unauthorized('NOT_SIGNED_IN', 'You are not signed in.');
    return request.auth;
  },
);
