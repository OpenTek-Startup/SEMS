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
      if ('notIn' in expected) checks.push(!(expected.notIn as unknown[]).includes(actual));
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
  type?: string;
  status?: string;
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

/**
 * A generic table with the flat operations the academic service uses
 * (no relations, no select: every row field is returned).
 */
export class FakeTable {
  rows: Row[] = [];

  /**
   * withId: give new rows a uuid. defaults: the column defaults of the real
   * table (@default(...) in schema.prisma, and null for optional columns),
   * which Postgres fills in and the services rely on.
   */
  constructor(
    private readonly withId = true,
    private readonly defaults: Row = {},
  ) {}

  private fresh(data: Row): Row {
    return this.withId ? { id: randomUUID(), ...this.defaults, ...data } : { ...this.defaults, ...data };
  }

  private find(where: Row = {}): Row {
    const row = this.rows.find((r) => matches(r, where));
    if (!row) throw new Error('Record to update/delete not found');
    return row;
  }

  readonly ops = {
    findMany: async ({ where }: Row = {}) => this.rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    findFirst: async ({ where }: Row = {}) => {
      const row = this.rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    },
    count: async ({ where }: Row = {}) => this.rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: Row) => {
      const row: Row = this.fresh(data);
      this.rows.push(row);
      return { ...row };
    },
    createMany: async ({ data }: Row) => {
      const list = (Array.isArray(data) ? data : [data]) as Row[];
      for (const d of list) this.rows.push(this.fresh(d));
      return { count: list.length };
    },
    update: async ({ where, data }: Row) => {
      const row = this.find(where);
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: Row) => {
      const hits = this.rows.filter((r) => matches(r, where));
      for (const r of hits) Object.assign(r, data);
      return { count: hits.length };
    },
    delete: async ({ where }: Row) => {
      const row = this.find(where);
      this.rows = this.rows.filter((r) => r !== row);
      return { ...row };
    },
    deleteMany: async ({ where }: Row = {}) => {
      const before = this.rows.length;
      this.rows = this.rows.filter((r) => !matches(r, where));
      return { count: before - this.rows.length };
    },
  };
}

export class FakeAuthDb {
  tenants: FakeTenant[] = [];
  users: Row[] = [];
  roles: FakeRole[] = [];
  userRoles: FakeUserRole[] = [];
  sessions: Row[] = [];
  audit: Row[] = [];
  /** Module catalogue: { code, name, category, description, dependsOn } */
  modules: Row[] = [];
  /** Module Registry rows: { tenantId, moduleCode, active } */
  tenantModules: Row[] = [];
  /** Permission catalogue: { id, code } (school creation grants from it) */
  permissions: Row[] = [];
  /** Academic structure (Phase 2) */
  readonly academicYears = new FakeTable();
  readonly terms = new FakeTable();
  readonly classes = new FakeTable();
  readonly sections = new FakeTable();
  readonly subjects = new FakeTable();
  readonly classSubjects = new FakeTable(false);
  /** Staff (Phase 2) */
  readonly staffMembers = new FakeTable(true, { status: 'active', email: null, phone: null, hireDate: null, userId: null });
  /** Teaching (Phase 2) */
  readonly teacherAssignments = new FakeTable();
  /** Assessment (Phase 3) */
  readonly assessments = new FakeTable(true, {
    maxScore: 20,
    weight: 1,
    heldOn: null,
    status: 'open',
    submittedAt: null,
    validatedAt: null,
    lockedAt: null,
  });
  /** Students and enrollment (Phase 2) */
  readonly students = new FakeTable(true, {
    status: 'active',
    dateOfBirth: null,
    placeOfBirth: null,
    guardianName: null,
    guardianPhone: null,
    guardianRelationship: null,
    admittedOn: null,
  });
  readonly enrollments = new FakeTable(true, { status: 'active', leftOn: null, reason: null });
  /** Marks (Phase 3) */
  readonly marks = new FakeTable(true, { score: null, absent: false });

  reset() {
    this.tenants = [];
    this.users = [];
    this.roles = [];
    this.userRoles = [];
    this.sessions = [];
    this.audit = [];
    this.modules = [];
    this.tenantModules = [];
    this.permissions = [];
    const tables = [
      this.academicYears,
      this.terms,
      this.classes,
      this.sections,
      this.subjects,
      this.classSubjects,
      this.staffMembers,
      this.teacherAssignments,
      this.assessments,
      this.students,
      this.enrollments,
      this.marks,
    ];
    for (const t of tables) {
      t.rows = [];
    }
  }

  /** Switch modules on for a school (test setup). */
  activate(tenantId: string, codes: string[]) {
    for (const moduleCode of codes) this.tenantModules.push({ tenantId, moduleCode, active: true });
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
    create: async ({ data }: Row) => {
      const role: FakeRole = {
        id: randomUUID(),
        tenantId: data.tenantId,
        name: data.name,
        archetype: data.archetype ?? null,
        permissions: [],
      };
      this.roles.push(role);
      return this.roleView(role);
    },
  };

  readonly permission = {
    findMany: async () => this.permissions.map((p) => ({ ...p })),
  };

  /** Grants are stored on the fake role as permission codes. */
  readonly rolePermission = {
    createMany: async ({ data }: Row) => {
      const rows = (Array.isArray(data) ? data : [data]) as Row[];
      for (const d of rows) {
        const role = this.roles.find((r) => r.id === d.roleId);
        const permission = this.permissions.find((p) => p.id === d.permissionId);
        if (role && permission && !role.permissions.includes(permission.code)) role.permissions.push(permission.code);
      }
      return { count: rows.length };
    },
  };

  readonly userRole = {
    create: async ({ data }: Row) => {
      this.userRoles.push({ ...(data as FakeUserRole) });
      return { ...data };
    },
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

  readonly tenant = {
    findMany: async () => [...this.tenants].sort((a, b) => a.name.localeCompare(b.name)),
    findUnique: async ({ where }: Row) => {
      const tenant = this.tenants.find((t) => matches(t, where));
      return tenant ? { ...tenant } : null;
    },
    create: async ({ data }: Row) => {
      const tenant = { id: randomUUID(), status: 'active', ...data } as FakeTenant;
      this.tenants.push(tenant);
      return { ...tenant };
    },
    update: async ({ where, data }: Row) => {
      const tenant = this.tenants.find((t) => matches(t, where));
      if (!tenant) throw new Error('tenant not found');
      Object.assign(tenant, data);
      return { ...tenant };
    },
  };

  readonly module = {
    findMany: async () =>
      [...this.modules]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((m) => ({ description: null, dependsOn: [], ...m })),
  };

  readonly tenantModule = {
    findMany: async ({ where }: Row = {}) => this.tenantModules.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    upsert: async ({ where, update, create }: Row) => {
      const key = where.tenantId_moduleCode;
      const row = this.tenantModules.find((r) => r.tenantId === key.tenantId && r.moduleCode === key.moduleCode);
      if (row) Object.assign(row, update);
      else this.tenantModules.push({ ...create });
      return { ...(row ?? create) };
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
      academicYear: this.academicYears.ops,
      term: this.terms.ops,
      schoolClass: this.classes.ops,
      section: this.sections.ops,
      subject: this.subjects.ops,
      classSubject: this.classSubjects.ops,
      staffMember: this.staffMembers.ops,
      teacherAssignment: this.teacherAssignments.ops,
      assessment: this.assessments.ops,
      student: this.students.ops,
      enrollment: this.enrollments.ops,
      mark: this.marks.ops,
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
