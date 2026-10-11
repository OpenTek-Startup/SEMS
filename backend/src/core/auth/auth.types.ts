import type { Request } from 'express';

/** Claims inside an access token. Short-lived; the session row is the source of truth. */
export interface AccessTokenPayload {
  /** user id */
  sub: string;
  /** session id */
  sid: string;
  /** school (tenant) id; null for a platform Super Admin */
  tid: string | null;
  typ: 'access';
}

/** Who is calling, attached to the request by AuthGuard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  tenantId: string | null;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Request details recorded with sessions and audit entries. */
export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}
