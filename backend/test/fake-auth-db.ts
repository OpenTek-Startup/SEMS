import { randomUUID } from 'node:crypto';

/**
 * A tiny in-memory stand-in for the Prisma calls AuthService and AuditService
 * make, so the auth e2e tests run without a database (also in CI).
 * It understands only the `where` shapes those services use.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected instanceof Date) return actual?.getTime() === expected.getTime();
    if (typeof expected === 'object') {
      if ('not' in expected) return actual !== expected.not;
      if ('gte' in expected) return actual >= expected.gte;
      if ('path' in expected) return actual?.[expected.path[0]] === expected.equals;
    }
    return actual === expected;
  });
}

export interface FakeTenant {
  id: string;
  slug: string;
  name: string;
}

export interface FakeRole {
  id: string;
  tenantId: string;
  name: string;
  archetype: string | null;
  permissions: string[];
}

export class FakeAuthDb {
  tenants: FakeTenant[] = [];
  users: Row[] = [];
  roles: FakeRole[] = [];
  /** userId -> roleIds */
  userRoles = new Map<string, string[]>();
  sessions: Row[] = [];
  audit: Row[] = [];

  reset() {
    this.tenants = [];
    this.users = [];
    this.roles = [];
    this.userRoles.clear();
    this.sessions = [];
    this.audit = [];
  }

  addUser(user: Row, roleIds: string[] = []) {
    const row = {
      id: randomUUID(),
      tenantId: null,
      status: 'active',
      isSuperAdmin: false,
      mustChangePassword: false,
      lastLoginAt: null,
      ...user,
    };
    this.users.push(row);
    this.userRoles.set(row.id, roleIds);
    return row;
  }

  /** User row enriched the way USER_VIEW_SELECT asks for it. */
  private userView(user: Row) {
    const tenant = this.tenants.find((t) => t.id === user.tenantId) ?? null;
    const roles = (this.userRoles.get(user.id) ?? [])
      .map((id) => this.roles.find((r) => r.id === id))
      .filter((r): r is FakeRole => !!r)
      .map((r) => ({
        role: {
          id: r.id,
          name: r.name,
          archetype: r.archetype,
          permissions: r.permissions.map((code) => ({ permission: { code } })),
        },
      }));
    return { ...user, tenant, roles };
  }

  private sessionView(session: Row) {
    const user = this.users.find((u) => u.id === session.userId);
    return { ...session, user: { ...user } };
  }

  readonly user = {
    findFirst: async ({ where }: Row) => {
      const user = this.users.find((u) => matches(u, where));
      return user ? { ...user } : null;
    },
    findUnique: async ({ where }: Row) => {
      const user = this.users.find((u) => matches(u, where));
      return user ? this.userView(user) : null;
    },
    update: async ({ where, data }: Row) => {
      const user = this.users.find((u) => matches(u, where));
      if (!user) throw new Error('user not found');
      Object.assign(user, data);
      return { ...user };
    },
  };

  readonly session = {
    create: async ({ data }: Row) => {
      const row = {
        id: randomUUID(),
        previousTokenHash: null,
        rotatedAt: null,
        revokedAt: null,
        revokedReason: null,
        createdAt: new Date(),
        ...data,
      };
      this.sessions.push(row);
      return { ...row };
    },
    findUnique: async ({ where }: Row) => {
      const session = this.sessions.find((s) => matches(s, where));
      return session ? this.sessionView(session) : null;
    },
    update: async ({ where, data }: Row) => {
      const session = this.sessions.find((s) => matches(s, where));
      if (!session) throw new Error('session not found');
      Object.assign(session, data);
      return { ...session };
    },
    updateMany: async ({ where, data }: Row) => {
      const hits = this.sessions.filter((s) => matches(s, where));
      for (const s of hits) Object.assign(s, data);
      return { count: hits.length };
    },
  };

  readonly auditLog = {
    create: async ({ data }: Row) => {
      const row = { id: randomUUID(), createdAt: new Date(), ...data };
      this.audit.push(row);
      return row;
    },
    count: async ({ where }: Row) => this.audit.filter((a) => matches(a, where)).length,
  };

  actions(): string[] {
    return this.audit.map((a) => a.action);
  }
}
