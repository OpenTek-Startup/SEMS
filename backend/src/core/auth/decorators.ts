import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from './auth.types';
import { unauthorized } from './auth.errors';

export const IS_PUBLIC = 'auth:public';
export const ALLOW_PENDING_PASSWORD_CHANGE = 'auth:allow-pending-password-change';

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

/** Injects the caller's AuthContext into a controller method. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw unauthorized('NOT_SIGNED_IN', 'You are not signed in.');
    return request.auth;
  },
);
