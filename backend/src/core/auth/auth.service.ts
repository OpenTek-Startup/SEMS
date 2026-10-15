import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { currentTenantId } from '../tenancy/tenant-context';
import {
  ACTIVITY_WRITE_INTERVAL_SECONDS,
  type AuthUserView,
  FAILED_LOGIN_WINDOW_MINUTES,
  hashToken,
  isIdle,
  MAX_FAILED_LOGINS,
  newRefreshToken,
  normalizeEmail,
  parseDurationSeconds,
  passwordProblems,
  REFRESH_REUSE_GRACE_SECONDS,
  toAuthUserView,
} from './auth-rules';
import { badRequest, forbidden, tooManyAttempts, unauthorized } from './auth.errors';
import type { AccessTokenPayload, AuthContext, ClientInfo } from './auth.types';

/** What a successful sign-in or refresh produces (the controller moves the refresh token into a cookie). */
export interface SignInResult {
  accessToken: string;
  /** access token lifetime in seconds */
  expiresIn: number;
  refreshToken: string;
  user: AuthUserView;
}

const USER_VIEW_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  isSuperAdmin: true,
  mustChangePassword: true,
  tenant: { select: { id: true, slug: true, name: true } },
  roles: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
          archetype: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

const SESSION_SELECT = {
  id: true,
  userId: true,
  tenantId: true,
  revokedAt: true,
  revokedReason: true,
  expiresAt: true,
  lastActiveAt: true,
  user: { select: { status: true, isSuperAdmin: true, mustChangePassword: true } },
} satisfies Prisma.SessionSelect;

interface SessionRow {
  id: string;
  userId: string;
  tenantId: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date;
  lastActiveAt: Date;
  user: { status: string; isSuperAdmin: boolean; mustChangePassword: boolean };
}

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

/**
 * Authentication (SRS FR-ID-01, session timeout, NFR-SEC-04):
 *  - email + password (Argon2id) -> short-lived JWT access token
 *    + rotating refresh token (httpOnly cookie, stored hashed in `sessions`)
 *  - a token only works for the school it was issued in
 *  - idle sessions end after SESSION_IDLE_MINUTES (default 15)
 *  - 5 failed sign-ins per email + IP + school in 15 minutes -> 429
 *  - every sign-in, failure, sign-out and password change is audited
 *
 * Uses the unscoped PrismaService on purpose: Super Admin sessions have no
 * school, and every query below filters by tenant/user/session explicitly.
 */
@Injectable()
export class AuthService {
  private readonly accessTtlSeconds: number;
  private readonly idleMinutes: number;
  private readonly maxSessionMs: number;
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.accessTtlSeconds = parseDurationSeconds(config.get<string>('jwt.expiresIn') ?? '15m');
    this.idleMinutes = config.get<number>('session.idleMinutes') ?? 15;
    this.maxSessionMs = (config.get<number>('session.maxHours') ?? 12) * 3_600_000;
  }

  /** Lifetime of the refresh cookie (= absolute session length). */
  get sessionMaxAgeMs(): number {
    return this.maxSessionMs;
  }

  // ------------------------------------------------------------- sign in

  async login(emailInput: string, password: string, client: ClientInfo): Promise<SignInResult> {
    const tenantId = currentTenantId() ?? null;
    const email = normalizeEmail(emailInput);

    await this.assertNotThrottled(email, tenantId, client);

    const found = await this.prisma.user.findFirst({
      where: { tenantId, email },
      select: { id: true, passwordHash: true, status: true, isSuperAdmin: true },
    });
    // Without a school, only platform Super Admins can sign in.
    const user = found && (tenantId !== null || found.isSuperAdmin) ? found : null;
    const passwordOk = await this.checkPassword(user?.passwordHash, password);

    if (!user || !passwordOk) {
      await this.audit.record({
        action: 'auth.login.failed',
        tenantId,
        actorUserId: user?.id ?? null,
        entity: 'user',
        entityId: user?.id ?? null,
        detail: { email, reason: user ? 'wrong_password' : 'unknown_email' },
        ipAddress: client.ipAddress,
      });
      // Same message either way: never reveal whether the email exists.
      throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    if (user.status !== 'active') {
      await this.audit.record({
        action: 'auth.login.failed',
        tenantId,
        actorUserId: user.id,
        entity: 'user',
        entityId: user.id,
        detail: { email, reason: 'account_disabled' },
        ipAddress: client.ipAddress,
      });
      throw forbidden('ACCOUNT_DISABLED', 'This account is disabled. Contact your school administrator.');
    }

    const now = new Date();
    const refreshToken = newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        tenantId,
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        lastActiveAt: now,
        expiresAt: new Date(now.getTime() + this.maxSessionMs),
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
      },
      select: { id: true },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });

    await this.audit.record({
      action: 'auth.login.success',
      tenantId,
      actorUserId: user.id,
      entity: 'session',
      entityId: session.id,
      ipAddress: client.ipAddress,
    });

    return this.issue(user.id, session.id, tenantId, refreshToken);
  }

  // ------------------------------------------------------------- refresh

  /** Exchanges a refresh token for a new access token and a NEW refresh token (rotation). */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<SignInResult> {
    if (!refreshToken) throw unauthorized('REFRESH_TOKEN_MISSING', SESSION_ENDED);

    const now = new Date();
    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash },
      select: SESSION_SELECT,
    });

    if (!session) {
      await this.detectReuse(tokenHash, now, client);
      throw unauthorized('REFRESH_TOKEN_INVALID', SESSION_ENDED);
    }

    await this.assertUsable(session, now);

    const next = newRefreshToken();
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: tokenHash, revokedAt: null },
      data: {
        refreshTokenHash: hashToken(next),
        previousTokenHash: tokenHash,
        rotatedAt: now,
        lastActiveAt: now,
      },
    });
    // Another request rotated this token a moment ago.
    if (rotated.count === 0) throw unauthorized('REFRESH_TOKEN_INVALID', SESSION_ENDED);

    return this.issue(session.userId, session.id, session.tenantId, next);
  }

  // ------------------------------------------------------------ sign out

  async logout(refreshToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!refreshToken) return;
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      select: { id: true, userId: true, tenantId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return;

    await this.revoke(session.id, 'logout');
    await this.audit.record({
      action: 'auth.logout',
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entity: 'session',
      entityId: session.id,
      ipAddress: client.ipAddress,
    });
  }

  // ------------------------------------------- every protected request

  /** Called by AuthGuard: validates the access token AND its session. */
  async authenticate(accessToken: string): Promise<AuthContext> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(accessToken, {
        algorithms: ['HS256'],
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        throw unauthorized('TOKEN_EXPIRED', 'Your sign-in has expired.');
      }
      throw unauthorized('TOKEN_INVALID', 'Invalid sign-in token.');
    }
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
      throw unauthorized('TOKEN_INVALID', 'Invalid sign-in token.');
    }

    // A Northfield token must never work on a Sunrise request (and vice versa).
    if ((payload.tid ?? null) !== (currentTenantId() ?? null)) {
      throw unauthorized('WRONG_SCHOOL', 'This sign-in belongs to a different school.');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: SESSION_SELECT,
    });
    if (!session || session.userId !== payload.sub) {
      throw unauthorized('SESSION_ENDED', SESSION_ENDED);
    }

    const now = new Date();
    await this.assertUsable(session, now);

    if (now.getTime() - session.lastActiveAt.getTime() > ACTIVITY_WRITE_INTERVAL_SECONDS * 1000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: now } });
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      tenantId: session.tenantId,
      isSuperAdmin: session.user.isSuperAdmin,
      mustChangePassword: session.user.mustChangePassword,
    };
  }

  // ----------------------------------------------------- profile/password

  /** Permission codes granted to a user through all of their roles. */
  async permissionsOf(userId: string): Promise<Set<string>> {
    return new Set((await this.userView(userId)).permissions);
  }

  async userView(userId: string): Promise<AuthUserView> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_VIEW_SELECT,
    });
    if (!row) throw unauthorized('SESSION_ENDED', SESSION_ENDED);
    return toAuthUserView(row);
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<AuthUserView> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, passwordHash: true, tenantId: true },
    });
    if (!user) throw unauthorized('SESSION_ENDED', SESSION_ENDED);

    if (!(await this.checkPassword(user.passwordHash, currentPassword))) {
      await this.audit.record({
        action: 'auth.password.change_failed',
        tenantId: user.tenantId,
        actorUserId: user.id,
        entity: 'user',
        entityId: user.id,
        ipAddress: client.ipAddress,
      });
      // 400, not 401: the session is fine, only the typed password is wrong.
      throw badRequest('WRONG_CURRENT_PASSWORD', 'Your current password is not correct.');
    }

    const problems = passwordProblems(newPassword, { email: user.email, currentPassword });
    if (problems.length > 0) throw badRequest('WEAK_PASSWORD', problems);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(newPassword), mustChangePassword: false },
    });

    // Sign out every other device that still knew the old password.
    const others = await this.prisma.session.updateMany({
      where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_changed' },
    });

    await this.audit.record({
      action: 'auth.password.changed',
      tenantId: user.tenantId,
      actorUserId: user.id,
      entity: 'user',
      entityId: user.id,
      detail: { otherSessionsEnded: others.count },
      ipAddress: client.ipAddress,
    });

    return this.userView(user.id);
  }

  // ------------------------------------------------------------- helpers

  private async issue(
    userId: string,
    sessionId: string,
    tenantId: string | null,
    refreshToken: string,
  ): Promise<SignInResult> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, tid: tenantId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds });
    return {
      accessToken,
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      user: await this.userView(userId),
    };
  }

  /** Session checks shared by refresh and every protected request. */
  private async assertUsable(session: SessionRow, now: Date): Promise<void> {
    if (session.revokedAt) {
      // Keep explaining an idle sign-out on the follow-up refresh call.
      if (session.revokedReason === 'idle') throw this.idleError();
      throw unauthorized('SESSION_ENDED', SESSION_ENDED);
    }

    if (session.tenantId !== (currentTenantId() ?? null)) {
      throw unauthorized('WRONG_SCHOOL', 'This sign-in belongs to a different school.');
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      throw unauthorized('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }

    if (isIdle(session.lastActiveAt, now, this.idleMinutes)) {
      await this.revoke(session.id, 'idle');
      await this.audit.record({
        action: 'auth.session.idle_timeout',
        tenantId: session.tenantId,
        actorUserId: session.userId,
        entity: 'session',
        entityId: session.id,
      });
      throw this.idleError();
    }

    if (session.user.status !== 'active') {
      await this.revoke(session.id, 'account_disabled');
      throw unauthorized('ACCOUNT_DISABLED', 'This account is disabled. Contact your school administrator.');
    }
  }

  private idleError() {
    return unauthorized(
      'SESSION_IDLE',
      `You were signed out after ${this.idleMinutes} minutes without activity. Please sign in again.`,
    );
  }

  /**
   * A refresh token that was already exchanged is presented again.
   * Within a few seconds that is two tabs racing; later it means the token
   * was copied, so the whole session is ended (FR-ID-01 acceptance).
   */
  private async detectReuse(tokenHash: string, now: Date, client: ClientInfo): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { previousTokenHash: tokenHash },
      select: { id: true, userId: true, tenantId: true, revokedAt: true, rotatedAt: true },
    });
    if (!session || session.revokedAt) return;

    const sinceRotationMs = session.rotatedAt
      ? now.getTime() - session.rotatedAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (sinceRotationMs <= REFRESH_REUSE_GRACE_SECONDS * 1000) return;

    await this.revoke(session.id, 'token_reuse');
    await this.audit.record({
      action: 'auth.refresh.reused',
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entity: 'session',
      entityId: session.id,
      ipAddress: client.ipAddress,
    });
    throw unauthorized(
      'REFRESH_TOKEN_REUSED',
      'For your safety this session was ended because an old sign-in token was reused. Please sign in again.',
    );
  }

  private async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** NFR-SEC-04: 5 failed attempts per (email, IP, school) per 15 minutes. */
  private async assertNotThrottled(email: string, tenantId: string | null, client: ClientInfo): Promise<void> {
    const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MINUTES * 60_000);
    const failures = await this.prisma.auditLog.count({
      where: {
        action: 'auth.login.failed',
        tenantId,
        ipAddress: client.ipAddress,
        createdAt: { gte: since },
        detail: { path: ['email'], equals: email },
      },
    });
    if (failures >= MAX_FAILED_LOGINS) {
      await this.audit.record({
        action: 'auth.login.blocked',
        tenantId,
        detail: { email },
        ipAddress: client.ipAddress,
      });
      throw tooManyAttempts(
        `Too many failed sign-in attempts. Wait ${FAILED_LOGIN_WINDOW_MINUTES} minutes and try again.`,
      );
    }
  }

  /**
   * Always runs one Argon2 verification, even for an unknown email, so the
   * response time does not reveal which emails exist.
   */
  private async checkPassword(passwordHash: string | undefined, password: string): Promise<boolean> {
    this.dummyHash ??= hash(newRefreshToken());
    const target = passwordHash ?? (await this.dummyHash);
    try {
      const ok = await verify(target, password);
      return ok && passwordHash !== undefined;
    } catch {
      return false;
    }
  }
}
