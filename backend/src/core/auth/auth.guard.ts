import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken } from './auth-rules';
import { forbidden, unauthorized } from './auth.errors';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC } from './decorators';

/**
 * Global guard (registered in AuthModule): every route needs a valid access
 * token unless it is marked @Public(). Runs after TenantMiddleware, so the
 * school of the request is already known and is compared with the token's.
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

    request.auth = auth;
    return true;
  }
}
