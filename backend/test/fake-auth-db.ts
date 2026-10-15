import { randomUUID } from 'node:crypto';
import { currentTenantId } from '../src/core/tenancy/tenant-context';
import { scopeArgs } from '../src/core/tenancy/tenant-scope';

/**
 * A tiny in-memory stand-in for the Prisma calls the services make, so the
 * e2e tests run without a database (also in CI). It understands only the
 * `where` shapes those services use. `scoped()` puts the REAL tenant-scope
 * rules in front of it, exactly like TenantPrismaService does.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected instanceof Date) return actual?.getTime() === expected.getTime();
    if (typeof expected === 'object') {
      if ('path' in expected) return actual?.[expected.path[0]] === expected.equals;
      // Every operator present must hold (e.g. { gte, lt } for a date range).
      const checks: boolean[] = [];
      if ('in' in expected) checks.push((expected.in as unknown[]).includes(actual));
      if ('not' in expected) checks.push(actual !== expected.not);
      if ('gte' in expected) checks.push(actual >= expected.gte);
      if ('lt' in expected) checks.push(actual < expected.lt);
      if ('lte' in expected) checks.push(actual <= expected.lte);
      if ('startsWith' in expected) checks.push(typeof actual === 'string' && actual.startsWith(expected.startsWith));
      return checks.length > 0 && checks.every(Boolean);
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

interface FakeUserRole {
  userId: string;
  roleId: string;
  tenantId: string;
}

export class FakeAuthDb {
  tenants: FakeTenant[] = [];
  users: Row[] = [];
  roles: FakeRole[] = [];
  userRoles: FakeUserRole[] = [];
  sessions: Row[] = [];
  audit: Row[] = [];

  reset() {
    this.tenants = [];
    this.users = [];
    this.roles = [];
    this.userRoles = [];
    this.sessions = [];
    this.audit = [];
  }

  addUser(user: Row, roleIds: string[] = []): Row {
    const row: Row = {
      id: randomUUID(),
      tenantId: null,
      status: 'active',
      isSuperAdmin: false,
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: new Date(),
      ...user,
    };
    this.users.push(row);
    for (const roleId of roleIds) {
      this.userRoles.push({ userId: row.id, roleId, tenantId: row.tenantId });
    }
    return row;
  }

  /** User row enriched with tenant and roles (superset of every select used). */
  private userView(user: Row) {
    const tenant = this.tenants.find((t) => t.id === user.tenantId) ?? null;
    const roles = this.userRoles
      .filter((ur) => ur.userId === user.id)
      .map((ur) => this.roles.find((r) => r.id === ur.roleId))
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

  private roleView(role: FakeRole) {
    return {
      ...role,
      description: null,
      isSystem: role.archetype !== null,
      permissions: role.permissions.map((code) => ({ permission: { code } })),
    };
  }

  private sessionView(session: Row) {
    const user = this.users.find((u) => u.id === session.userId);
    return { ...session, user: { ...user } };
  }

  readonly user = {
    findFirst: async ({ where }: Row = {}) => {
      const user = this.users.find((u) => matches(u, where));
      return user ? this.userView(user) : null;
    },
    findUnique: async ({ where }: Row) => {
      const user = this.users.find((u) => matches(u, where));
      return user ? this.userView(user) : null;
    },
    findMany: async ({ where }: Row = {}) =>
      this.users.filter((u) => matches(u, where)).map((u) => this.userView(u)),
    create: async ({ data }: Row) => this.userView(this.addUser(data)),
    update: async ({ where, data }: Row) => {
      const user = this.users.find((u) => matches(u, where));
      if (!user) throw new Error('user not found');
      Object.assign(user, data);
      return this.userView(user);
    },
  };

  readonly role = {
    findMany: async ({ where }: Row = {}) =>
      this.roles.filter((r) => matches(r, where)).map((r) => this.roleView(r)),
  };

  readonly userRole = {
    deleteMany: async ({ where }: Row = {}) => {
      const before = this.userRoles.length;
      this.userRoles = this.userRoles.filter((ur) => !matches(ur, where));
      return { count: before - this.userRoles.length };
    },
    createMany: async ({ data }: Row) => {
      const rows = (Array.isArray(data) ? data : [data]) as FakeUserRole[];
      this.userRoles.push(...rows.map((r) => ({ ...r })));
      return { count: rows.length };
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
      const row = { id: randomUUID(), createdAt: new Date(), seq: this.audit.length, ...data };
      this.audit.push(row);
      return row;
    },
    count: async ({ where }: Row = {}) => this.audit.filter((a) => matches(a, where)).length,
    /** Newest first (createdAt, then insertion order), with the actor joined. */
    findMany: async ({ where, skip = 0, take }: Row = {}) =>
      this.audit
        .filter((a) => matches(a, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
        .slice(skip, take === undefined ? undefined : skip + take)
        .map((a) => {
          const actor = this.users.find((u) => u.id === a.actorUserId);
          return {
            ...a,
            actor: actor
              ? { id: actor.id, firstName: actor.firstName, lastName: actor.lastName, email: actor.email }
              : null,
          };
        }),
  };

  actions(): string[] {
    return this.audit.map((a) => a.action);
  }

  /**
   * The same models seen through the real tenant-scope rules, standing in
   * for TenantPrismaService.db in tests.
   */
  scoped() {
    const models: Record<string, Row> = {
      user: this.user,
      role: this.role,
      userRole: this.userRole,
      session: this.session,
      auditLog: this.auditLog,
    };
    const client: Row = {};
    for (const [key, ops] of Object.entries(models)) {
      const model = key[0].toUpperCase() + key.slice(1);
      client[key] = Object.fromEntries(
        Object.entries(ops).map(([op, fn]) => [
          op,
          (args?: Row) => (fn as (a?: Row) => Promise<unknown>)(scopeArgs(model, op, args, currentTenantId())),
        ]),
      );
    }
    client.$transaction = (fn: (tx: Row) => Promise<unknown>) => fn(client);
    return client;
  }
}
