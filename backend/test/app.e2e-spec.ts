import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import { TenantPrismaService } from './../src/core/tenancy/tenant-prisma.service';
import { FakeAuthDb } from './fake-auth-db';
import { RequireModule, RequirePermission } from './../src/core/auth/decorators';
import { ModuleRegistryService } from './../src/core/modules/module-registry.service';
import { TenantDirectory } from './../src/core/tenancy/tenant-directory.service';

// The e2e suite runs without a real database (also in CI):
// the Prisma client is replaced by fakes whose answers we control.
const queryRaw = jest.fn();
const findTenant = jest.fn();
const fakeDb = new FakeAuthDb();
jest.mock('./../src/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

/** A protected route with no special rules, to test the global AuthGuard. */
@Controller('probe')
class ProbeController {
  @Get()
  ok() {
    return { ok: true };
  }

  /** A route of the Assessment module (closed while the module is inactive). */
  @Get('assessment')
  @RequireModule('assessment')
  assessment() {
    return { ok: true };
  }

  /** A route that needs a Students permission (no module gate). */
  @Get('students')
  @RequirePermission('student.record.view')
  students() {
    return { ok: true };
  }
}

describe('YESE API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // The unscoped client (platform code, auth, tenant lookup).
    const unscoped: Record<string, any> = {
      $queryRaw: queryRaw,
      tenant: {
        findUnique: findTenant,
        findMany: fakeDb.tenant.findMany,
        create: fakeDb.tenant.create,
        update: fakeDb.tenant.update,
      },
      module: fakeDb.module,
      tenantModule: fakeDb.tenantModule,
      user: fakeDb.user,
      session: fakeDb.session,
      auditLog: fakeDb.auditLog,
      permission: fakeDb.permission,
      role: fakeDb.role,
      rolePermission: fakeDb.rolePermission,
      userRole: fakeDb.userRole,
    };
    unscoped.$transaction = (fn: (tx: Record<string, any>) => Promise<unknown>) => fn(unscoped);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue(unscoped)
      // School-scoped client: the fake behind the REAL tenant-scope rules.
      .overrideProvider(TenantPrismaService)
      .useValue({ db: fakeDb.scoped() })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app); // same prefix, pipes, filter and interceptor as main.ts
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    queryRaw.mockReset();
    findTenant.mockReset();
  });

  it('GET /api/health returns ok when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const res = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'connected' });
  });

  it('GET /api/health returns 503 in the error shape when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app.getHttpServer()).get('/api/health').expect(503);

    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(503);
    expect(res.body.error).toMatchObject({ database: 'unreachable' });
  });

  it('unknown routes return 404 in the error shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.path).toBe('/api/nope');
  });
  describe('tenancy', () => {
    const school = (slug: string, status: 'active' | 'suspended') => ({
      id: '11111111-1111-4111-8111-111111111111',
      slug,
      name: `School ${slug}`,
      type: 'secondary',
      status,
    });

    it('GET /api/tenant/current returns the school named in X-Tenant', async () => {
      findTenant.mockResolvedValue(school('northfield', 'active'));

      const res = await request(app.getHttpServer())
        .get('/api/tenant/current')
        .set('X-Tenant', 'northfield')
        .expect(200);

      expect(res.body.data).toMatchObject({ slug: 'northfield', name: 'School northfield' });
      expect(findTenant).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'northfield' } }));
    });

    it('unknown school returns 404', async () => {
      findTenant.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/api/tenant/current')
        .set('X-Tenant', 'ghost-school')
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('suspended school returns 403', async () => {
      findTenant.mockResolvedValue(school('closed-school', 'suspended'));

      await request(app.getHttpServer())
        .get('/api/tenant/current')
        .set('X-Tenant', 'closed-school')
        .expect(403);
    });

    it('invalid school names are rejected without a database lookup', async () => {
      await request(app.getHttpServer())
        .get('/api/tenant/current')
        .set('X-Tenant', 'bad name!')
        .expect(404);

      expect(findTenant).not.toHaveBeenCalled();
    });

    it('a school-scoped route without a school returns 400', async () => {
      await request(app.getHttpServer()).get('/api/tenant/current').expect(400);
    });

    it('platform routes such as /api/health work without a school', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(findTenant).not.toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    const NORTHFIELD = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'northfield',
      name: 'School northfield',
      type: 'secondary',
      status: 'active',
    };
    const SUNRISE = {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'sunrise',
      name: 'School sunrise',
      type: 'secondary',
      status: 'active',
    };
    const PASSWORD = 'Northfield2026';
    const ROLE_ADMIN = 'a0000000-0000-4000-8000-000000000001';
    const ROLE_TEACHER = 'a0000000-0000-4000-8000-000000000002';
    const ROLE_SUNRISE_ADMIN = 'a0000000-0000-4000-8000-000000000003';
    const ADMIN_PERMISSIONS = [
      'core.audit.view',
      'core.role.manage',
      'core.user.manage',
      'core.user.view',
      'student.record.view',
    ];
    let passwordHash: string;

    const http = () => request(app.getHttpServer());

    /** Signs in and returns the access token and the refresh cookie. */
    async function signIn(email: string, school: string | null = 'northfield', password = PASSWORD) {
      const headers: Record<string, string> = school ? { 'X-Tenant': school } : {};
      const res = await http().post('/api/auth/login').set(headers).send({ email, password }).expect(200);
      return { res, token: res.body.data.accessToken as string, cookie: refreshCookie(res) };
    }

    function refreshCookie(res: { headers: Record<string, any> }): string {
      const raw = res.headers['set-cookie'] as string[] | undefined;
      const line = (raw ?? []).find((c) => c.startsWith('yese_rt='));
      if (!line) throw new Error('no refresh cookie in response');
      return line.split(';')[0];
    }

    beforeAll(async () => {
      passwordHash = await hash(PASSWORD);
    });

    beforeEach(() => {
      fakeDb.reset();
      // Copies: a test may suspend a school, the next one starts fresh.
      fakeDb.tenants = [{ ...NORTHFIELD }, { ...SUNRISE }];
      fakeDb.roles = [
        { id: ROLE_ADMIN, tenantId: NORTHFIELD.id, name: 'Administrator', archetype: 'admin', permissions: ADMIN_PERMISSIONS },
        {
          id: ROLE_TEACHER,
          tenantId: NORTHFIELD.id,
          name: 'Staff / Teacher',
          archetype: 'staff',
          permissions: ['attendance.register.take', 'student.record.view'],
        },
        { id: ROLE_SUNRISE_ADMIN, tenantId: SUNRISE.id, name: 'Administrator', archetype: 'admin', permissions: ADMIN_PERMISSIONS },
      ];
      fakeDb.addUser(
        { tenantId: NORTHFIELD.id, email: 'admin@northfield.school', firstName: 'M.', lastName: 'Ndzana', passwordHash },
        [ROLE_ADMIN],
      );
      fakeDb.addUser(
        { tenantId: NORTHFIELD.id, email: 'teacher@northfield.school', firstName: 'R.', lastName: 'Fon', passwordHash },
        [ROLE_TEACHER],
      );
      fakeDb.addUser(
        { tenantId: SUNRISE.id, email: 'admin@sunrise.school', firstName: 'School', lastName: 'Administrator', passwordHash },
        [ROLE_SUNRISE_ADMIN],
      );
      fakeDb.addUser({
        tenantId: NORTHFIELD.id,
        email: 'new@northfield.school',
        firstName: 'New',
        lastName: 'Teacher',
        passwordHash,
        mustChangePassword: true,
      });
      fakeDb.addUser({
        tenantId: NORTHFIELD.id,
        email: 'gone@northfield.school',
        firstName: 'Former',
        lastName: 'Teacher',
        passwordHash,
        status: 'disabled',
      });
      fakeDb.addUser({
        tenantId: null,
        email: 'superadmin@yese.local',
        firstName: 'Platform',
        lastName: 'Super Admin',
        passwordHash,
        isSuperAdmin: true,
      });
      findTenant.mockImplementation(({ where }: { where: { slug?: string; id?: string } }) =>
        Promise.resolve(
          // A copy, like a real database read: a cached answer only changes when the cache is cleared.
          ((t) => (t ? { ...t } : null))(fakeDb.tenants.find((t) => t.slug === where.slug || t.id === where.id)),
        ),
      );
      app.get(TenantDirectory).invalidateAll();

      // Module Registry: a small catalogue; Northfield runs Students + Academic, Sunrise only Students.
      fakeDb.modules = [
        { code: 'core', name: 'Core platform', category: 'core', dependsOn: [] },
        { code: 'student', name: 'Students', category: 'business', dependsOn: [] },
        { code: 'academic', name: 'Academic structure', category: 'business', dependsOn: [] },
        { code: 'enrollment', name: 'Enrollment', category: 'business', dependsOn: ['student', 'academic'] },
        { code: 'assessment', name: 'Assessment', category: 'business', dependsOn: ['academic', 'enrollment'] },
      ];
      fakeDb.activate(NORTHFIELD.id, ['student', 'academic']);
      fakeDb.activate(SUNRISE.id, ['student']);
      app.get(ModuleRegistryService).invalidateAll();
    });

    it('signs in: access token + user in JSON, refresh token in an httpOnly cookie', async () => {
      const { res } = await signIn('Admin@Northfield.school');

      expect(res.body.data).toMatchObject({
        expiresIn: 900,
        user: {
          email: 'admin@northfield.school',
          school: { slug: 'northfield' },
          roles: [{ name: 'Administrator', archetype: 'admin' }],
          permissions: ADMIN_PERMISSIONS,
          mustChangePassword: false,
        },
      });
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user).not.toHaveProperty('passwordHash');

      const cookie = (res.headers['set-cookie'] as string[]).join(';');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/auth/);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(fakeDb.actions()).toContain('auth.login.success');
      expect(fakeDb.sessions).toHaveLength(1);
      expect(fakeDb.sessions[0].refreshTokenHash).not.toBe(refreshCookie(res).split('=')[1]);
    });

    it('wrong password and unknown email get the same generic 401', async () => {
      const wrong = await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'northfield')
        .send({ email: 'admin@northfield.school', password: 'nope-nope-1' })
        .expect(401);
      const unknown = await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'northfield')
        .send({ email: 'ghost@northfield.school', password: 'nope-nope-1' })
        .expect(401);

      expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
      expect(fakeDb.actions().filter((a) => a === 'auth.login.failed')).toHaveLength(2);
    });

    it('an account of one school cannot sign in at another school', async () => {
      await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'sunrise')
        .send({ email: 'admin@northfield.school', password: PASSWORD })
        .expect(401);
    });

    it('protects routes by default and accepts a valid token', async () => {
      const none = await http().get('/api/probe').set('X-Tenant', 'northfield').expect(401);
      expect(none.body.error.code).toBe('NOT_SIGNED_IN');

      const { token } = await signIn('admin@northfield.school');
      await http().get('/api/probe').set('X-Tenant', 'northfield').set('Authorization', `Bearer ${token}`).expect(200);

      const me = await http()
        .get('/api/auth/me')
        .set('X-Tenant', 'northfield')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.data.email).toBe('admin@northfield.school');
    });

    it("rejects a Northfield token on a Sunrise request (or with no school)", async () => {
      const { token } = await signIn('admin@northfield.school');

      const sunrise = await http()
        .get('/api/auth/me')
        .set('X-Tenant', 'sunrise')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(sunrise.body.error.code).toBe('WRONG_SCHOOL');

      await http().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('rejects a tampered token', async () => {
      const { token } = await signIn('admin@northfield.school');
      const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
      const res = await http()
        .get('/api/auth/me')
        .set('X-Tenant', 'northfield')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rotates the refresh token, and ends the session if an old one is replayed later', async () => {
      const { cookie: first } = await signIn('admin@northfield.school');

      const refreshed = await http().post('/api/auth/refresh').set('X-Tenant', 'northfield').set('Cookie', first).expect(200);
      const second = refreshCookie(refreshed);
      expect(second).not.toBe(first);
      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

      // Replayed seconds later (two tabs racing): refused, session kept.
      const race = await http().post('/api/auth/refresh').set('X-Tenant', 'northfield').set('Cookie', first).expect(401);
      expect(race.body.error.code).toBe('REFRESH_TOKEN_INVALID');
      expect(fakeDb.sessions[0].revokedAt).toBeNull();

      // Replayed a minute later: treated as theft, the whole session ends.
      fakeDb.sessions[0].rotatedAt = new Date(Date.now() - 60_000);
      const reuse = await http().post('/api/auth/refresh').set('X-Tenant', 'northfield').set('Cookie', first).expect(401);
      expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      expect(fakeDb.sessions[0].revokedReason).toBe('token_reuse');
      await http().post('/api/auth/refresh').set('X-Tenant', 'northfield').set('Cookie', second).expect(401);
    });

    it('logout revokes the session and clears the cookie', async () => {
      const { token, cookie } = await signIn('admin@northfield.school');

      const out = await http().post('/api/auth/logout').set('X-Tenant', 'northfield').set('Cookie', cookie).expect(200);
      expect((out.headers['set-cookie'] as string[]).join(';')).toMatch(/yese_rt=;/);
      expect(fakeDb.actions()).toContain('auth.logout');

      const me = await http()
        .get('/api/auth/me')
        .set('X-Tenant', 'northfield')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(me.body.error.code).toBe('SESSION_ENDED');
      await http().post('/api/auth/refresh').set('X-Tenant', 'northfield').set('Cookie', cookie).expect(401);
    });

    it('ends a session after 15 idle minutes', async () => {
      const { token, cookie } = await signIn('admin@northfield.school');
      fakeDb.sessions[0].lastActiveAt = new Date(Date.now() - 16 * 60_000);

      const res = await http()
        .get('/api/auth/me')
        .set('X-Tenant', 'northfield')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body.error.code).toBe('SESSION_IDLE');
      expect(fakeDb.sessions[0].revokedReason).toBe('idle');

      // The automatic refresh that follows explains the same reason.
      const again = await http().post('/api/auth/refresh').set('X-Tenant', 'northfield').set('Cookie', cookie).expect(401);
      expect(again.body.error.code).toBe('SESSION_IDLE');
    });

    it('forces a password change before anything else, then signs out other devices', async () => {
      const other = await signIn('new@northfield.school');
      const { token, res } = await signIn('new@northfield.school');
      expect(res.body.data.user.mustChangePassword).toBe(true);
      const auth = { 'X-Tenant': 'northfield', Authorization: `Bearer ${token}` };

      const blocked = await http().get('/api/probe').set(auth).expect(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await http().get('/api/auth/me').set(auth).expect(200);

      const wrong = await http()
        .post('/api/auth/change-password')
        .set(auth)
        .send({ currentPassword: 'not-it-123', newPassword: 'BrandNew2026' })
        .expect(400);
      expect(wrong.body.error.code).toBe('WRONG_CURRENT_PASSWORD');

      const weak = await http()
        .post('/api/auth/change-password')
        .set(auth)
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');

      const done = await http()
        .post('/api/auth/change-password')
        .set(auth)
        .send({ currentPassword: PASSWORD, newPassword: 'BrandNew2026' })
        .expect(200);
      expect(done.body.data.mustChangePassword).toBe(false);

      await http().get('/api/probe').set(auth).expect(200);
      await http()
        .get('/api/auth/me')
        .set({ 'X-Tenant': 'northfield', Authorization: `Bearer ${other.token}` })
        .expect(401);
      expect(fakeDb.actions()).toContain('auth.password.changed');

      await signIn('new@northfield.school', 'northfield', 'BrandNew2026');
    });

    it('blocks sign-in after 5 failed attempts, even with the right password', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/auth/login')
          .set('X-Tenant', 'northfield')
          .send({ email: 'admin@northfield.school', password: `wrong-${i}-pass` })
          .expect(401);
      }
      const res = await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'northfield')
        .send({ email: 'admin@northfield.school', password: PASSWORD })
        .expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('refuses disabled accounts', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'northfield')
        .send({ email: 'gone@northfield.school', password: PASSWORD })
        .expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    });

    it('platform Super Admin signs in without a school, and only there', async () => {
      const { res } = await signIn('superadmin@yese.local', null);
      expect(res.body.data.user).toMatchObject({ isSuperAdmin: true, school: null });

      await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'northfield')
        .send({ email: 'superadmin@yese.local', password: PASSWORD })
        .expect(401);
    });

    it('validates the login body', async () => {
      await http()
        .post('/api/auth/login')
        .set('X-Tenant', 'northfield')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);
    });

    describe('permissions and user administration', () => {
      const NF = { 'X-Tenant': 'northfield' };

      async function headersFor(email: string, school = 'northfield', password = PASSWORD) {
        const { token } = await signIn(email, school, password);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const userId = (email: string) => fakeDb.users.find((u) => u.email === email)!.id as string;

      it('refuses a route to anyone without the permission (403 PERMISSION_DENIED)', async () => {
        const teacher = await headersFor('teacher@northfield.school');
        const res = await http().get('/api/users').set(teacher).expect(403);
        expect(res.body.error.code).toBe('PERMISSION_DENIED');
        expect(res.body.error.message).toContain('core.user.view');

        // The platform Super Admin holds no school permissions either.
        const { token } = await signIn('superadmin@yese.local', null);
        await http().get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
      });

      it("lists only the current school's users and roles", async () => {
        const admin = await headersFor('admin@northfield.school');

        const users = await http().get('/api/users').set(admin).expect(200);
        const emails = (users.body.data as { email: string }[]).map((u) => u.email);
        expect(emails).toEqual(
          expect.arrayContaining(['admin@northfield.school', 'teacher@northfield.school']),
        );
        expect(emails).not.toContain('admin@sunrise.school');
        expect(emails).not.toContain('superadmin@yese.local');
        expect(users.body.data[0]).not.toHaveProperty('passwordHash');

        const roles = await http().get('/api/roles').set(admin).expect(200);
        expect((roles.body.data as { name: string }[]).map((r) => r.name)).toEqual([
          'Administrator',
          'Staff / Teacher',
        ]);
      });

      it('creates a user with a one-time password that must be changed', async () => {
        const admin = await headersFor('admin@northfield.school');

        const res = await http()
          .post('/api/users')
          .set(admin)
          .send({ email: 'New.Teacher@Northfield.school', firstName: 'Ada', lastName: 'Mbah', roleIds: [ROLE_TEACHER] })
          .expect(201);
        const { user, temporaryPassword } = res.body.data;
        expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
        expect(user).toMatchObject({
          email: 'new.teacher@northfield.school',
          mustChangePassword: true,
          roles: [{ name: 'Staff / Teacher' }],
        });
        expect(fakeDb.users.find((u) => u.id === user.id)?.tenantId).toBe(NORTHFIELD.id);
        expect(fakeDb.actions()).toContain('user.created');

        const login = await signIn('new.teacher@northfield.school', 'northfield', temporaryPassword);
        expect(login.res.body.data.user.mustChangePassword).toBe(true);

        const again = await http()
          .post('/api/users')
          .set(admin)
          .send({ email: 'new.teacher@northfield.school', firstName: 'Ada', lastName: 'Mbah', roleIds: [] })
          .expect(409);
        expect(again.body.error.code).toBe('EMAIL_TAKEN');
      });

      it("cannot use another school's role or reach another school's user", async () => {
        const admin = await headersFor('admin@northfield.school');

        const role = await http()
          .post('/api/users')
          .set(admin)
          .send({ email: 'x@northfield.school', firstName: 'X', lastName: 'Y', roleIds: [ROLE_SUNRISE_ADMIN] })
          .expect(400);
        expect(role.body.error.code).toBe('UNKNOWN_ROLE');

        const sunriseAdmin = userId('admin@sunrise.school');
        const res = await http()
          .patch(`/api/users/${sunriseAdmin}/status`)
          .set(admin)
          .send({ status: 'disabled' })
          .expect(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
        expect(fakeDb.users.find((u) => u.id === sunriseAdmin)?.status).toBe('active');
      });

      it('disabling a user signs them out at once', async () => {
        const teacher = await headersFor('teacher@northfield.school');
        const admin = await headersFor('admin@northfield.school');
        const id = userId('teacher@northfield.school');

        const res = await http().patch(`/api/users/${id}/status`).set(admin).send({ status: 'disabled' }).expect(200);
        expect(res.body.data.status).toBe('disabled');
        await http().get('/api/auth/me').set(teacher).expect(401);
        expect(fakeDb.actions()).toContain('user.disabled');

        await http().patch(`/api/users/${id}/status`).set(admin).send({ status: 'active' }).expect(200);
      });

      it('a role change applies on the very next request', async () => {
        const teacher = await headersFor('teacher@northfield.school');
        const admin = await headersFor('admin@northfield.school');
        await http().get('/api/users').set(teacher).expect(403);

        const res = await http()
          .put(`/api/users/${userId('teacher@northfield.school')}/roles`)
          .set(admin)
          .send({ roleIds: [ROLE_TEACHER, ROLE_ADMIN] })
          .expect(200);
        expect((res.body.data.roles as { name: string }[]).map((r) => r.name)).toEqual([
          'Administrator',
          'Staff / Teacher',
        ]);
        expect(fakeDb.userRoles.every((ur) => ur.tenantId === NORTHFIELD.id || ur.roleId === ROLE_SUNRISE_ADMIN)).toBe(true);

        await http().get('/api/users').set(teacher).expect(200);
        expect(fakeDb.actions()).toContain('user.roles.updated');
      });

      it('reset password: one-time password, old sessions end, change forced (FR-ID-02)', async () => {
        const teacher = await headersFor('teacher@northfield.school');
        const admin = await headersFor('admin@northfield.school');

        const res = await http()
          .post(`/api/users/${userId('teacher@northfield.school')}/reset-password`)
          .set(admin)
          .expect(200);
        const { temporaryPassword } = res.body.data;
        expect(res.body.data.user.mustChangePassword).toBe(true);

        await http().get('/api/auth/me').set(teacher).expect(401);
        await http()
          .post('/api/auth/login')
          .set(NF)
          .send({ email: 'teacher@northfield.school', password: PASSWORD })
          .expect(401);
        const login = await signIn('teacher@northfield.school', 'northfield', temporaryPassword);
        expect(login.res.body.data.user.mustChangePassword).toBe(true);
        expect(fakeDb.actions()).toContain('user.password.reset');
      });

      it('an administrator cannot disable, demote or reset themselves', async () => {
        const admin = await headersFor('admin@northfield.school');
        const me = userId('admin@northfield.school');

        const status = await http().patch(`/api/users/${me}/status`).set(admin).send({ status: 'disabled' }).expect(400);
        expect(status.body.error.code).toBe('CANNOT_CHANGE_SELF');
        await http().put(`/api/users/${me}/roles`).set(admin).send({ roleIds: [] }).expect(400);
        await http().post(`/api/users/${me}/reset-password`).set(admin).expect(400);
      });

      it('validates ids and bodies', async () => {
        const admin = await headersFor('admin@northfield.school');
        await http().patch('/api/users/not-a-uuid/status').set(admin).send({ status: 'disabled' }).expect(400);
        await http()
          .post('/api/users')
          .set(admin)
          .send({ email: 'y@northfield.school', firstName: 'Y', lastName: 'Z', roleIds: ['x'] })
          .expect(400);
        await http()
          .patch(`/api/users/${userId('teacher@northfield.school')}/status`)
          .set(admin)
          .send({ status: 'deleted' })
          .expect(400);
      });
    });

    describe('audit log', () => {
      async function headersFor(email: string, school = 'northfield', password = PASSWORD) {
        const { token } = await signIn(email, school, password);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const userId = (email: string) => fakeDb.users.find((u) => u.email === email)!.id as string;
      type Item = { action: string; actor: { email: string } | null; target: { email: string } | null; id: string };

      it('needs core.audit.view', async () => {
        const teacher = await headersFor('teacher@northfield.school');
        const res = await http().get('/api/audit').set(teacher).expect(403);
        expect(res.body.error.code).toBe('PERMISSION_DENIED');
      });

      it("shows only this school's events, newest first, with names", async () => {
        await headersFor('admin@sunrise.school', 'sunrise'); // a Sunrise event that must stay invisible
        const admin = await headersFor('admin@northfield.school');
        await http()
          .post('/api/users')
          .set(admin)
          .send({ email: 'kofi@northfield.school', firstName: 'Kofi', lastName: 'Asante', roleIds: [ROLE_TEACHER] })
          .expect(201);

        const res = await http().get('/api/audit').set(admin).expect(200);
        const items = res.body.data.items as Item[];
        expect(items[0]).toMatchObject({
          action: 'user.created',
          actor: { email: 'admin@northfield.school' },
          target: { email: 'kofi@northfield.school' },
        });
        expect(items.map((i) => i.action)).toContain('auth.login.success');
        expect(items.every((i) => i.actor?.email !== 'admin@sunrise.school')).toBe(true);
        expect(res.body.data).toMatchObject({ page: 1, pageSize: 25, total: items.length });
      });

      it('filters by category, exact action, person and date, and pages', async () => {
        await headersFor('teacher@northfield.school');
        const admin = await headersFor('admin@northfield.school');
        await http()
          .post(`/api/users/${userId('teacher@northfield.school')}/reset-password`)
          .set(admin)
          .expect(200);
        const get = (query: string) => http().get(`/api/audit${query}`).set(admin).expect(200);

        const users = (await get('?action=user.')).body.data.items as Item[];
        expect(users.map((i) => i.action)).toEqual(['user.password.reset']);

        const logins = (await get('?action=auth.login.success')).body.data;
        expect(logins.total).toBe(2);

        const byTeacher = (await get(`?actorUserId=${userId('teacher@northfield.school')}`)).body.data.items as Item[];
        expect(byTeacher.length).toBeGreaterThan(0);
        expect(byTeacher.every((i) => i.actor?.email === 'teacher@northfield.school')).toBe(true);

        expect((await get('?from=2099-01-01')).body.data.total).toBe(0);
        const today = new Date().toISOString().slice(0, 10);
        expect((await get(`?from=${today}&to=${today}`)).body.data.total).toBe(3);

        const first = (await get('?pageSize=1&page=1')).body.data;
        const second = (await get('?pageSize=1&page=2')).body.data;
        expect(first.items).toHaveLength(1);
        expect(second.items).toHaveLength(1);
        expect(first.items[0].id).not.toBe(second.items[0].id);
      });

      it('rejects bad filters', async () => {
        const admin = await headersFor('admin@northfield.school');
        await http().get('/api/audit?action=Not%20An%20Action').set(admin).expect(400);
        const range = await http().get('/api/audit?from=2026-10-15&to=2026-10-01').set(admin).expect(400);
        expect(range.body.error.code).toBe('INVALID_FILTER');
        await http().get('/api/audit?pageSize=500').set(admin).expect(400);
        await http().get('/api/audit?actorUserId=nope').set(admin).expect(400);
        await http().get('/api/audit?unknown=1').set(admin).expect(400);
      });
    });

    it('Phase 1, end to end: first sign-in, a new teacher, a role, isolation and the audit trail', async () => {
      const admin = fakeDb.users.find((u) => u.email === 'admin@northfield.school')!;
      admin.mustChangePassword = true; // a freshly seeded administrator

      // 1. The administrator signs in and must replace the temporary password first.
      const first = await signIn('admin@northfield.school');
      const adminAuth = { 'X-Tenant': 'northfield', Authorization: `Bearer ${first.token}` };
      expect((await http().get('/api/users').set(adminAuth).expect(403)).body.error.code).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
      await http()
        .post('/api/auth/change-password')
        .set(adminAuth)
        .send({ currentPassword: PASSWORD, newPassword: 'AdminNew2026' })
        .expect(200);

      // 2. They create a teacher, who gets a one-time password.
      const created = await http()
        .post('/api/users')
        .set(adminAuth)
        .send({ email: 'kofi@northfield.school', firstName: 'Kofi', lastName: 'Asante', roleIds: [ROLE_TEACHER] })
        .expect(201);
      const { temporaryPassword, user: kofi } = created.body.data;

      // 3. The teacher signs in, chooses a password, and cannot administer users.
      const t = await signIn('kofi@northfield.school', 'northfield', temporaryPassword);
      const teacherAuth = { 'X-Tenant': 'northfield', Authorization: `Bearer ${t.token}` };
      await http()
        .post('/api/auth/change-password')
        .set(teacherAuth)
        .send({ currentPassword: temporaryPassword, newPassword: 'KofiNew2026' })
        .expect(200);
      expect((await http().get('/api/users').set(teacherAuth).expect(403)).body.error.code).toBe('PERMISSION_DENIED');

      // 4. Given the Administrator role, the very next request is allowed.
      await http()
        .put(`/api/users/${kofi.id}/roles`)
        .set(adminAuth)
        .send({ roleIds: [ROLE_TEACHER, ROLE_ADMIN] })
        .expect(200);
      await http().get('/api/users').set(teacherAuth).expect(200);

      // 5. Sunrise sees none of it, and Kofi's token is useless there.
      const sunrise = await signIn('admin@sunrise.school', 'sunrise');
      const sunriseAuth = { 'X-Tenant': 'sunrise', Authorization: `Bearer ${sunrise.token}` };
      const sunriseUsers = (await http().get('/api/users').set(sunriseAuth).expect(200)).body.data as { email: string }[];
      expect(sunriseUsers.map((u) => u.email)).not.toContain('kofi@northfield.school');
      expect((await http().get('/api/audit').set(sunriseAuth).expect(200)).body.data.items).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ action: 'user.created' })]),
      );
      await http().get('/api/users').set({ ...teacherAuth, 'X-Tenant': 'sunrise' }).expect(401);

      // 6. Every step is in Northfield's audit trail.
      const trail = (await http().get('/api/audit?pageSize=100').set(adminAuth).expect(200)).body.data
        .items as { action: string; actor: { email: string } | null; target: { email: string } | null }[];
      const actions = trail.map((i) => i.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'auth.login.success',
          'auth.password.changed',
          'user.created',
          'user.roles.updated',
        ]),
      );
      expect(actions.filter((a) => a === 'auth.password.changed')).toHaveLength(2);
      expect(trail.find((i) => i.action === 'user.roles.updated')).toMatchObject({
        actor: { email: 'admin@northfield.school' },
        target: { email: 'kofi@northfield.school' },
      });

      // 7. Signing out ends the session.
      await http().post('/api/auth/logout').set('X-Tenant', 'northfield').set('Cookie', first.cookie).expect(200);
      await http().get('/api/users').set(adminAuth).expect(401);
    });

    describe('module registry (Phase 1.5)', () => {
      async function superAdmin() {
        const { token } = await signIn('superadmin@yese.local', null);
        return { Authorization: `Bearer ${token}` };
      }
      async function schoolAdmin(school = 'northfield') {
        const email = school === 'northfield' ? 'admin@northfield.school' : 'admin@sunrise.school';
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const setModule = (auth: Record<string, string>, tenantId: string, code: string, active: boolean) =>
        http().put(`/api/platform/schools/${tenantId}/modules/${code}`).set(auth).send({ active });

      it('platform routes are for the Super Admin only', async () => {
        await http().get('/api/platform/schools').expect(401);
        const admin = await schoolAdmin();
        const res = await http().get('/api/platform/schools').set(admin).expect(403);
        expect(res.body.error.code).toBe('SUPER_ADMIN_ONLY');
      });

      it('the Super Admin sees every school with its modules, and the catalogue', async () => {
        const sa = await superAdmin();
        const schools = (await http().get('/api/platform/schools').set(sa).expect(200)).body.data;
        expect(schools).toEqual([
          expect.objectContaining({ slug: 'northfield', activeModules: ['academic', 'core', 'student'] }),
          expect.objectContaining({ slug: 'sunrise', activeModules: ['core', 'student'] }),
        ]);
        const modules = (await http().get('/api/platform/modules').set(sa).expect(200)).body.data;
        expect(modules.find((m: { code: string }) => m.code === 'enrollment').dependsOn).toEqual(['student', 'academic']);
      });

      it('activation needs every dependency, in order (FR-PL-03)', async () => {
        const sa = await superAdmin();
        const refused = await setModule(sa, SUNRISE.id, 'assessment', true).expect(409);
        expect(refused.body.error).toMatchObject({ code: 'MODULE_DEPENDENCY_INACTIVE', missing: ['academic', 'enrollment'] });

        await setModule(sa, SUNRISE.id, 'academic', true).expect(200);
        await setModule(sa, SUNRISE.id, 'enrollment', true).expect(200);
        const done = await setModule(sa, SUNRISE.id, 'assessment', true).expect(200);
        expect(done.body.data.activeModules).toEqual(['academic', 'assessment', 'core', 'enrollment', 'student']);

        const entry = fakeDb.audit.find((a) => a.action === 'module.activated' && a.detail?.module === 'assessment');
        expect(entry).toMatchObject({ tenantId: SUNRISE.id, entity: 'module' });
      });

      it('deactivation is refused while another module needs it; core stays on', async () => {
        const sa = await superAdmin();
        await setModule(sa, NORTHFIELD.id, 'enrollment', true).expect(200);

        const needed = await setModule(sa, NORTHFIELD.id, 'academic', false).expect(409);
        expect(needed.body.error).toMatchObject({ code: 'MODULE_REQUIRED_BY', dependents: ['enrollment'] });

        expect((await setModule(sa, NORTHFIELD.id, 'core', false).expect(400)).body.error.code).toBe('MODULE_CORE');
        expect((await setModule(sa, NORTHFIELD.id, 'nope', true).expect(404)).body.error.code).toBe('MODULE_NOT_FOUND');
        await setModule(sa, '99999999-9999-4999-8999-999999999999', 'student', true).expect(404);
        await http().put(`/api/platform/schools/${NORTHFIELD.id}/modules/student`).set(sa).send({ active: 'yes' }).expect(400);
      });

      it("an inactive module closes its routes and its permissions stop counting (FR-ID-06)", async () => {
        const sa = await superAdmin();
        const admin = await schoolAdmin();

        const closed = await http().get('/api/probe/assessment').set(admin).expect(403);
        expect(closed.body.error.code).toBe('MODULE_INACTIVE');
        await http().get('/api/probe/students').set(admin).expect(200);

        await setModule(sa, NORTHFIELD.id, 'student', false).expect(200);

        const denied = await http().get('/api/probe/students').set(admin).expect(403);
        expect(denied.body.error.code).toBe('PERMISSION_DENIED');
        const me = (await http().get('/api/auth/me').set(admin).expect(200)).body.data;
        expect(me.permissions).not.toContain('student.record.view');
        expect(me.permissions).toContain('core.user.view');

        await setModule(sa, NORTHFIELD.id, 'student', true).expect(200);
        await http().get('/api/probe/students').set(admin).expect(200);
      });

      it("GET /api/modules shows the school's own modules", async () => {
        const admin = await schoolAdmin('sunrise');
        const modules = (await http().get('/api/modules').set(admin).expect(200)).body.data as {
          code: string;
          active: boolean;
          core: boolean;
        }[];
        expect(modules.filter((m) => m.active).map((m) => m.code)).toEqual(['core', 'student']);
        expect(modules.find((m) => m.code === 'core')?.core).toBe(true);

        const sa = await superAdmin();
        await http().get('/api/modules').set(sa).expect(400);
      });
    });

    describe('schools: create, suspend, reactivate (FR-PL-01, FR-PL-02)', () => {
      const OTHER_ID = '99999999-9999-4999-8999-999999999999';
      const NEW_SCHOOL = {
        name: '  Hillside   College ',
        slug: ' Hillside ',
        type: 'secondary',
        adminEmail: 'Head@Hillside.school',
        adminFirstName: 'Ama',
        adminLastName: 'Tabi',
      };

      async function superAdmin() {
        const { token } = await signIn('superadmin@yese.local', null);
        return { Authorization: `Bearer ${token}` };
      }

      beforeEach(() => {
        fakeDb.permissions = [
          'core.user.view',
          'core.user.manage',
          'core.role.manage',
          'core.audit.view',
          'student.record.view',
          'staff.record.view',
          'academic.structure.view',
        ].map((code, i) => ({ id: `f0000000-0000-4000-8000-00000000000${i}`, code }));
      });

      it('only the Super Admin can create or suspend a school', async () => {
        await http().post('/api/platform/schools').send(NEW_SCHOOL).expect(401);
        const { token } = await signIn('admin@northfield.school');
        const admin = { 'X-Tenant': 'northfield', Authorization: `Bearer ${token}` };
        const res = await http().post('/api/platform/schools').set(admin).send(NEW_SCHOOL).expect(403);
        expect(res.body.error.code).toBe('SUPER_ADMIN_ONLY');
        await http().patch(`/api/platform/schools/${SUNRISE.id}/status`).set(admin).send({ status: 'suspended' }).expect(403);
      });

      it('creates the school, its four base roles and a first administrator who must change the password', async () => {
        const sa = await superAdmin();
        // Unknown before, and that answer is cached: creating the school must clear it.
        await http().get('/api/tenant/current').set('X-Tenant', 'hillside').expect(404);

        const res = await http().post('/api/platform/schools').set(sa).send(NEW_SCHOOL).expect(201);
        const { school, admin, temporaryPassword } = res.body.data;
        expect(school).toMatchObject({ slug: 'hillside', name: 'Hillside College', type: 'secondary', status: 'active', activeModules: ['core'] });
        expect(admin).toEqual({ email: 'head@hillside.school', firstName: 'Ama', lastName: 'Tabi' });
        expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

        const roles = fakeDb.roles.filter((r) => r.tenantId === school.id);
        expect(roles.map((r) => r.name).sort()).toEqual(['Administrator', 'Parent', 'Staff / Teacher', 'Student']);
        expect(roles.find((r) => r.archetype === 'admin')!.permissions).toHaveLength(fakeDb.permissions.length);
        expect(roles.find((r) => r.archetype === 'staff')!.permissions.sort()).toEqual([
          'academic.structure.view',
          'staff.record.view',
          'student.record.view',
        ]);
        expect(roles.find((r) => r.archetype === 'parent')!.permissions).toEqual([]);

        const audit = fakeDb.audit.find((a) => a.action === 'tenant.created');
        expect(audit).toMatchObject({ tenantId: school.id, entity: 'tenant', entityId: school.id, detail: { slug: 'hillside' } });

        const login = await signIn('head@hillside.school', 'hillside', temporaryPassword);
        expect(login.res.body.data.user).toMatchObject({
          mustChangePassword: true,
          school: { id: school.id, slug: 'hillside', name: 'Hillside College' },
        });
        expect(login.res.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual(['Administrator']);

        const schools = (await http().get('/api/platform/schools').set(sa).expect(200)).body.data;
        expect(schools.map((s: { slug: string }) => s.slug)).toEqual(['hillside', 'northfield', 'sunrise']);
      });

      it('refuses taken, reserved or badly formed school codes', async () => {
        const sa = await superAdmin();
        const send = (body: object) => http().post('/api/platform/schools').set(sa).send({ ...NEW_SCHOOL, ...body });

        expect((await send({ slug: 'Northfield' }).expect(409)).body.error.code).toBe('SLUG_TAKEN');
        expect((await send({ slug: 'admin' }).expect(400)).body.error.code).toBe('SLUG_RESERVED');
        expect((await send({ slug: 'hill side' }).expect(400)).body.error.code).toBe('SLUG_INVALID');
        expect((await send({ slug: 'hi' }).expect(400)).body.error.code).toBe('SLUG_INVALID');
        await send({ type: 'college' }).expect(400);
        await send({ adminEmail: 'not-an-email' }).expect(400);
        await send({ name: '   ' }).expect(400);
        expect(fakeDb.tenants).toHaveLength(2);
      });

      it('suspending closes the school at once and signs everyone out; reactivating opens it again', async () => {
        const sa = await superAdmin();
        const { token } = await signIn('admin@sunrise.school', 'sunrise');
        const sunrise = { 'X-Tenant': 'sunrise', Authorization: `Bearer ${token}` };
        await http().get('/api/auth/me').set(sunrise).expect(200); // the school is now cached as active

        const suspended = await http().patch(`/api/platform/schools/${SUNRISE.id}/status`).set(sa).send({ status: 'suspended' }).expect(200);
        expect(suspended.body.data).toMatchObject({ slug: 'sunrise', status: 'suspended' });

        const blocked = await http().get('/api/auth/me').set(sunrise).expect(403);
        expect(blocked.body.error.code).toBe('SCHOOL_SUSPENDED');
        await http().post('/api/auth/login').set('X-Tenant', 'sunrise').send({ email: 'admin@sunrise.school', password: PASSWORD }).expect(403);
        const sessions = fakeDb.sessions.filter((s) => s.tenantId === SUNRISE.id);
        expect(sessions.length).toBeGreaterThan(0);
        expect(sessions.every((s) => s.revokedReason === 'school_suspended')).toBe(true);

        // Other schools are not affected.
        await signIn('admin@northfield.school');

        await http().patch(`/api/platform/schools/${SUNRISE.id}/status`).set(sa).send({ status: 'active' }).expect(200);
        await signIn('admin@sunrise.school', 'sunrise');
        expect(fakeDb.actions()).toEqual(expect.arrayContaining(['tenant.suspended', 'tenant.reactivated']));

        await http().patch(`/api/platform/schools/${OTHER_ID}/status`).set(sa).send({ status: 'active' }).expect(404);
        await http().patch(`/api/platform/schools/${SUNRISE.id}/status`).set(sa).send({ status: 'closed' }).expect(400);
      });
    });

    describe('staff (Phase 2)', () => {
      const STAFF = ['staff.record.edit', 'staff.record.view'];
      const OTHER_ID = '99999999-9999-4999-8999-999999999999';

      async function as(email: string, school = 'northfield') {
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const admin = () => as('admin@northfield.school');
      const post = (auth: Record<string, string>, body: object) => http().post('/api/staff').set(auth).send(body);
      const patch = (auth: Record<string, string>, url: string, body: object) =>
        http().patch(`/api/staff${url}`).set(auth).send(body);
      const get = (auth: Record<string, string>, url = '') => http().get(`/api/staff${url}`).set(auth);
      const BRENDA = {
        firstName: ' Brenda ',
        lastName: 'Ngwa',
        position: 'Mathematics   teacher',
        email: 'B.Ngwa@Northfield.school',
        phone: ' +237 677 12 34 56',
        hireDate: '2019-09-02',
      };

      beforeEach(() => {
        fakeDb.modules.push({ code: 'staff', name: 'Staff', category: 'business', dependsOn: [] });
        fakeDb.activate(NORTHFIELD.id, ['staff']);
        app.get(ModuleRegistryService).invalidateAll();
        // Northfield's administrator manages staff; the teacher may only read the list.
        for (const role of fakeDb.roles) {
          if (role.id === ROLE_ADMIN) role.permissions = [...ADMIN_PERMISSIONS, ...STAFF];
          if (role.id === ROLE_SUNRISE_ADMIN) role.permissions = [...ADMIN_PERMISSIONS, ...STAFF];
          if (role.id === ROLE_TEACHER) role.permissions = [...role.permissions, 'staff.record.view'];
        }
      });

      it('needs the Staff module and the staff permissions', async () => {
        await http().get('/api/staff').set('X-Tenant', 'northfield').expect(401);

        const sunrise = await as('admin@sunrise.school', 'sunrise');
        expect((await get(sunrise).expect(403)).body.error.code).toBe('MODULE_INACTIVE');

        const teacher = await as('teacher@northfield.school');
        await get(teacher).expect(200);
        expect((await post(teacher, BRENDA).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
        await get(teacher, '/accounts').expect(403);
      });

      it('creates staff with a generated number, cleaned fields and an audit entry', async () => {
        const auth = await admin();
        const first = (await post(auth, BRENDA).expect(201)).body.data;
        expect(first).toMatchObject({
          staffNumber: 'STF-0001',
          firstName: 'Brenda',
          lastName: 'Ngwa',
          fullName: 'Ngwa Brenda',
          position: 'Mathematics teacher',
          email: 'b.ngwa@northfield.school',
          phone: '+237 677 12 34 56',
          category: 'teaching',
          status: 'active',
          hireDate: '2019-09-02',
          account: null,
        });

        const own = (await post(auth, { firstName: 'Peter', lastName: 'Achu', position: 'Bursar', category: 'non_teaching', staffNumber: ' nf/2017/01 ' }).expect(201)).body.data;
        expect(own).toMatchObject({ staffNumber: 'NF/2017/01', category: 'non_teaching', email: null, phone: null, hireDate: null });

        const next = (await post(auth, { firstName: 'Grace', lastName: 'Mbah', position: 'English teacher' }).expect(201)).body.data;
        expect(next.staffNumber).toBe('STF-0002');

        const taken = await post(auth, { ...BRENDA, staffNumber: 'stf-0001' }).expect(409);
        expect(taken.body.error.code).toBe('STAFF_NUMBER_TAKEN');
        expect((await post(auth, { ...BRENDA, staffNumber: 'a' }).expect(400)).body.error.code).toBe('STAFF_NUMBER_INVALID');
        expect((await post(auth, { ...BRENDA, phone: '123' }).expect(400)).body.error.code).toBe('PHONE_INVALID');
        expect((await post(auth, { ...BRENDA, hireDate: '2019-02-30' }).expect(400)).body.error.code).toBe('DATE_INVALID');
        await post(auth, { ...BRENDA, category: 'cleaner' }).expect(400);
        await post(auth, { ...BRENDA, position: '  ' }).expect(400);
        await post(auth, { ...BRENDA, salary: 100000 }).expect(400);

        const entry = fakeDb.audit.find((a) => a.action === 'staff.created' && a.entityId === first.id);
        expect(entry).toMatchObject({ tenantId: NORTHFIELD.id, entity: 'staff', detail: { staffNumber: 'STF-0001' } });
      });

      it('lists by name, searches and filters', async () => {
        const auth = await admin();
        await post(auth, BRENDA).expect(201);
        await post(auth, { firstName: 'Éric', lastName: 'Abena', position: 'Bursar', category: 'non_teaching' }).expect(201);
        const paul = (await post(auth, { firstName: 'Paul', lastName: 'Zama', position: 'History teacher' }).expect(201)).body.data;
        await patch(auth, `/${paul.id}/status`, { status: 'inactive' }).expect(200);

        const names = (res: { body: { data: { lastName: string }[] } }) => res.body.data.map((s) => s.lastName);
        expect(names(await get(auth).expect(200))).toEqual(['Abena', 'Ngwa', 'Zama']);
        expect(names(await get(auth, '?status=active').expect(200))).toEqual(['Abena', 'Ngwa']);
        expect(names(await get(auth, '?category=teaching').expect(200))).toEqual(['Ngwa', 'Zama']);
        expect(names(await get(auth, '?search=eric').expect(200))).toEqual(['Abena']);
        expect(names(await get(auth, '?search=brenda%20math').expect(200))).toEqual(['Ngwa']);
        await get(auth, '?status=gone').expect(400);
      });

      it('edits a record, clears optional fields and keeps numbers unique', async () => {
        const auth = await admin();
        const brenda = (await post(auth, BRENDA).expect(201)).body.data;
        const grace = (await post(auth, { firstName: 'Grace', lastName: 'Mbah', position: 'English teacher' }).expect(201)).body.data;

        const edited = (await patch(auth, `/${brenda.id}`, { position: 'Head of Mathematics', phone: null, hireDate: null }).expect(200)).body.data;
        expect(edited).toMatchObject({ position: 'Head of Mathematics', phone: null, hireDate: null, email: 'b.ngwa@northfield.school' });
        const entry = fakeDb.audit.filter((a) => a.action === 'staff.updated').pop();
        expect(entry?.detail).toEqual({ changed: ['hireDate', 'phone', 'position'] });

        const before = fakeDb.audit.length;
        await patch(auth, `/${brenda.id}`, { position: 'Head of Mathematics' }).expect(200);
        expect(fakeDb.audit.length).toBe(before); // nothing changed, nothing recorded

        const clash = await patch(auth, `/${grace.id}`, { staffNumber: 'STF-0001' }).expect(409);
        expect(clash.body.error.code).toBe('STAFF_NUMBER_TAKEN');
        await patch(auth, `/${grace.id}`, { staffNumber: 'STF-0100' }).expect(200);
        expect((await get(auth, `/${OTHER_ID}`).expect(404)).body.error.code).toBe('STAFF_NOT_FOUND');
        await get(auth, '/not-a-uuid').expect(400);
      });

      it('links a staff record to one user account of the same school', async () => {
        const auth = await admin();
        const brenda = (await post(auth, BRENDA).expect(201)).body.data;
        const grace = (await post(auth, { firstName: 'Grace', lastName: 'Mbah', position: 'English teacher' }).expect(201)).body.data;
        const teacher = fakeDb.users.find((u) => u.email === 'teacher@northfield.school')!;
        const sunriseAdmin = fakeDb.users.find((u) => u.email === 'admin@sunrise.school')!;

        const accounts = (await get(auth, '/accounts').expect(200)).body.data as { email: string }[];
        expect(accounts.map((a) => a.email)).toContain('teacher@northfield.school');
        expect(accounts.map((a) => a.email)).not.toContain('gone@northfield.school'); // disabled
        expect(accounts.map((a) => a.email)).not.toContain('admin@sunrise.school'); // other school

        const linked = (await http().put(`/api/staff/${brenda.id}/account`).set(auth).send({ userId: teacher.id }).expect(200)).body.data;
        expect(linked.account).toEqual({ id: teacher.id, email: 'teacher@northfield.school', status: 'active' });
        expect(((await get(auth, '/accounts')).body.data as { id: string }[]).map((a) => a.id)).not.toContain(teacher.id);

        const twice = await http().put(`/api/staff/${grace.id}/account`).set(auth).send({ userId: teacher.id }).expect(409);
        expect(twice.body.error.code).toBe('ACCOUNT_ALREADY_LINKED');
        const foreign = await http().put(`/api/staff/${grace.id}/account`).set(auth).send({ userId: sunriseAdmin.id }).expect(400);
        expect(foreign.body.error.code).toBe('USER_NOT_FOUND');

        const unlinked = (await http().put(`/api/staff/${brenda.id}/account`).set(auth).send({ userId: null }).expect(200)).body.data;
        expect(unlinked.account).toBeNull();
        expect(fakeDb.actions()).toEqual(expect.arrayContaining(['staff.account.linked', 'staff.account.unlinked']));
      });

      it("a school never sees another school's staff", async () => {
        const auth = await admin();
        const brenda = (await post(auth, BRENDA).expect(201)).body.data;

        fakeDb.activate(SUNRISE.id, ['staff']);
        app.get(ModuleRegistryService).invalidateAll();
        const sunrise = await as('admin@sunrise.school', 'sunrise');
        expect((await get(sunrise).expect(200)).body.data).toEqual([]);
        await get(sunrise, `/${brenda.id}`).expect(404);
        await patch(sunrise, `/${brenda.id}`, { position: 'Hacked' }).expect(404);
        await patch(sunrise, `/${brenda.id}/status`, { status: 'inactive' }).expect(404);

        // Sunrise numbers its own staff from STF-0001 too.
        const own = (await post(sunrise, { firstName: 'Ada', lastName: 'Ebot', position: 'Biology teacher' }).expect(201)).body.data;
        expect(own.staffNumber).toBe('STF-0001');
        expect(fakeDb.staffMembers.rows.find((r) => r.id === brenda.id)).toMatchObject({ tenantId: NORTHFIELD.id, position: 'Mathematics teacher' });
      });
    });

    describe('academic structure (Phase 2)', () => {
      const ACADEMIC = ['academic.structure.manage', 'academic.structure.view'];
      const OTHER_ID = '99999999-9999-4999-8999-999999999999';

      async function as(email: string, school = 'northfield') {
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const admin = () => as('admin@northfield.school');
      const post = (auth: Record<string, string>, url: string, body: object) =>
        http().post(`/api/academic${url}`).set(auth).send(body);
      const patch = (auth: Record<string, string>, url: string, body: object) =>
        http().patch(`/api/academic${url}`).set(auth).send(body);
      const del = (auth: Record<string, string>, url: string) => http().delete(`/api/academic${url}`).set(auth);
      const get = (auth: Record<string, string>, url: string) => http().get(`/api/academic${url}`).set(auth);

      beforeEach(() => {
        // Northfield's administrator manages the structure; the teacher may only read it.
        for (const role of fakeDb.roles) {
          if (role.archetype === 'admin') role.permissions = [...ADMIN_PERMISSIONS, ...ACADEMIC];
          if (role.id === ROLE_TEACHER) role.permissions = [...role.permissions, 'academic.structure.view'];
        }
      });

      it('needs the Academic module and the academic permissions', async () => {
        await http().get('/api/academic/years').set('X-Tenant', 'northfield').expect(401);

        const sunrise = await as('admin@sunrise.school', 'sunrise');
        expect((await get(sunrise, '/years').expect(403)).body.error.code).toBe('MODULE_INACTIVE');

        const teacher = await as('teacher@northfield.school');
        await get(teacher, '/years').expect(200);
        await get(teacher, '/classes').expect(200);
        const denied = await post(teacher, '/classes', { name: 'Form 1', level: 1 }).expect(403);
        expect(denied.body.error.code).toBe('PERMISSION_DENIED');

        const me = (await http().get('/api/auth/me').set(teacher).expect(200)).body.data;
        expect(me.permissions).toContain('academic.structure.view');
      });

      it('academic years: the first becomes current, names and dates are checked, one current year', async () => {
        const auth = await admin();
        const first = await post(auth, '/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' }).expect(201);
        expect(first.body.data).toMatchObject({ name: '2026-2027', isCurrent: true, startDate: '2026-09-07', terms: [] });

        const older = await post(auth, '/years', { name: '2025-2026', startDate: '2025-09-08', endDate: '2026-06-30' }).expect(201);
        expect(older.body.data.isCurrent).toBe(false);

        const taken = await post(auth, '/years', { name: ' 2026-2027 ', startDate: '2027-09-06', endDate: '2028-06-30' }).expect(409);
        expect(taken.body.error.code).toBe('NAME_TAKEN');
        const overlap = await post(auth, '/years', { name: 'Calendar 2026', startDate: '2026-01-01', endDate: '2026-12-31' }).expect(409);
        expect(overlap.body.error.code).toBe('YEARS_OVERLAP');

        const backwards = await post(auth, '/years', { name: 'X', startDate: '2028-06-30', endDate: '2027-09-06' }).expect(400);
        expect(backwards.body.error.code).toBe('DATES_INVALID');
        const impossible = await post(auth, '/years', { name: 'X', startDate: '2027-02-30', endDate: '2027-06-30' }).expect(400);
        expect(impossible.body.error.code).toBe('DATE_INVALID');
        const tooLong = await post(auth, '/years', { name: 'X', startDate: '2027-09-06', endDate: '2029-06-30' }).expect(400);
        expect(tooLong.body.error.code).toBe('YEAR_TOO_LONG');
        await post(auth, '/years', { name: 'X', startDate: '06/09/2027', endDate: '2028-06-30' }).expect(400);

        await http().post(`/api/academic/years/${older.body.data.id}/current`).set(auth).expect(200);
        const years = (await get(auth, '/years').expect(200)).body.data as { name: string; isCurrent: boolean }[];
        expect(years.map((y) => [y.name, y.isCurrent])).toEqual([
          ['2026-2027', false],
          ['2025-2026', true],
        ]);
        expect((await get(auth, '/current').expect(200)).body.data.year).toMatchObject({ name: '2025-2026' });

        const current = await del(auth, `/years/${older.body.data.id}`).expect(409);
        expect(current.body.error.code).toBe('YEAR_IS_CURRENT');
        await del(auth, `/years/${first.body.data.id}`).expect(200);
        expect((await get(auth, '/years')).body.data).toHaveLength(1);
      });

      it('terms stay inside their year and never overlap', async () => {
        const auth = await admin();
        const current = (await post(auth, '/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' })).body.data;
        const next = (await post(auth, '/years', { name: '2027-2028', startDate: '2027-09-06', endDate: '2028-06-30' })).body.data;

        await post(auth, `/years/${current.id}/terms`, { name: 'Second Term', startDate: '2027-01-04', endDate: '2027-03-26' }).expect(201);
        const year = (await post(auth, `/years/${current.id}/terms`, { name: 'First Term', startDate: '2026-09-07', endDate: '2026-12-11' }).expect(201)).body.data;
        expect(year.terms.map((t: { name: string }) => t.name)).toEqual(['First Term', 'Second Term']);

        const overlap = await post(auth, `/years/${current.id}/terms`, { name: 'Mock exams', startDate: '2026-12-11', endDate: '2026-12-18' }).expect(409);
        expect(overlap.body.error).toMatchObject({ code: 'TERMS_OVERLAP', with: 'First Term' });
        const outside = await post(auth, `/years/${current.id}/terms`, { name: 'Summer', startDate: '2027-07-01', endDate: '2027-08-15' }).expect(400);
        expect(outside.body.error.code).toBe('TERM_OUTSIDE_YEAR');
        const sameName = await post(auth, `/years/${current.id}/terms`, { name: 'first term', startDate: '2027-04-12', endDate: '2027-06-30' }).expect(409);
        expect(sameName.body.error.code).toBe('NAME_TAKEN');

        const shrink = await patch(auth, `/years/${current.id}`, { endDate: '2027-02-28' }).expect(409);
        expect(shrink.body.error).toMatchObject({ code: 'YEAR_TERMS_OUTSIDE', terms: ['Second Term'] });

        const third = await post(auth, `/years/${next.id}/terms`, { name: 'First Term', startDate: '2027-09-06', endDate: '2027-12-10' }).expect(201);
        expect((await del(auth, `/years/${next.id}`).expect(409)).body.error.code).toBe('YEAR_NOT_EMPTY');
        const termId = third.body.data.terms[0].id;
        const renamed = await patch(auth, `/terms/${termId}`, { name: 'Term 1' }).expect(200);
        expect(renamed.body.data.terms[0]).toMatchObject({ name: 'Term 1', startDate: '2027-09-06' });
        await del(auth, `/terms/${termId}`).expect(200);
        await del(auth, `/years/${next.id}`).expect(200);
        await patch(auth, `/terms/${OTHER_ID}`, { name: 'Ghost' }).expect(404);
      });

      it('classes, sections and subjects with coefficients', async () => {
        const auth = await admin();
        const math = (await post(auth, '/subjects', { code: ' math ', name: 'Mathematics' }).expect(201)).body.data;
        expect(math).toMatchObject({ code: 'MATH', name: 'Mathematics', classCount: 0 });
        const eng = (await post(auth, '/subjects', { code: 'ENG', name: 'English Language' }).expect(201)).body.data;
        expect((await post(auth, '/subjects', { code: 'Math', name: 'Maths' }).expect(409)).body.error.code).toBe('CODE_TAKEN');
        await post(auth, '/subjects', { code: 'MATHS AND MORE', name: 'X' }).expect(400);

        const form1 = (await post(auth, '/classes', { name: 'Form 1', level: 1 }).expect(201)).body.data;
        await post(auth, '/classes', { name: 'Form 2', level: 2 }).expect(201);
        expect((await post(auth, '/classes', { name: 'form  1', level: 3 }).expect(409)).body.error.code).toBe('NAME_TAKEN');

        await post(auth, `/classes/${form1.id}/sections`, { name: 'B' }).expect(201);
        const withA = (await post(auth, `/classes/${form1.id}/sections`, { name: 'A', capacity: 45 }).expect(201)).body.data;
        expect(withA.sections.map((s: { label: string }) => s.label)).toEqual(['Form 1 A', 'Form 1 B']);
        expect((await post(auth, `/classes/${form1.id}/sections`, { name: 'a' }).expect(409)).body.error.code).toBe('NAME_TAKEN');

        const put = (subjects: object[]) => http().put(`/api/academic/classes/${form1.id}/subjects`).set(auth).send({ subjects });
        const set = await put([
          { subjectId: math.id, coefficient: 4 },
          { subjectId: eng.id, coefficient: 3 },
        ]).expect(200);
        expect(set.body.data.subjects.map((s: { code: string }) => s.code)).toEqual(['ENG', 'MATH']);
        expect(set.body.data.totalCoefficient).toBe(7);
        expect((await put([{ subjectId: math.id, coefficient: 4 }, { subjectId: math.id, coefficient: 2 }]).expect(400)).body.error.code).toBe(
          'DUPLICATE_SUBJECT',
        );
        expect((await put([{ subjectId: OTHER_ID, coefficient: 2 }]).expect(400)).body.error.code).toBe('UNKNOWN_SUBJECT');
        await put([{ subjectId: math.id, coefficient: 0 }]).expect(400);

        const classes = (await get(auth, '/classes').expect(200)).body.data;
        expect(classes.map((c: { name: string }) => c.name)).toEqual(['Form 1', 'Form 2']);
        expect(classes[0].sections[0]).toMatchObject({ name: 'A', capacity: 45 });
        const sections = (await get(auth, '/sections').expect(200)).body.data;
        expect(sections.map((s: { label: string }) => s.label)).toEqual(['Form 1 A', 'Form 1 B']);
        const subjects = (await get(auth, '/subjects').expect(200)).body.data;
        expect(subjects.map((s: { code: string; classCount: number }) => [s.code, s.classCount])).toEqual([
          ['ENG', 1],
          ['MATH', 1],
        ]);

        const inUse = await del(auth, `/subjects/${math.id}`).expect(409);
        expect(inUse.body.error).toMatchObject({ code: 'SUBJECT_IN_USE', classes: ['Form 1'] });
        expect((await del(auth, `/classes/${form1.id}`).expect(409)).body.error.code).toBe('CLASS_NOT_EMPTY');
        for (const s of withA.sections) await del(auth, `/sections/${s.id}`).expect(200);
        await del(auth, `/classes/${form1.id}`).expect(200);
        await del(auth, `/subjects/${math.id}`).expect(200);

        const renamed = await patch(auth, `/subjects/${eng.id}`, { name: 'English' }).expect(200);
        expect(renamed.body.data).toMatchObject({ code: 'ENG', name: 'English', classCount: 0 });
      });

      it("a school never sees or changes another school's structure", async () => {
        fakeDb.activate(SUNRISE.id, ['academic']);
        app.get(ModuleRegistryService).invalidateAll();
        const north = await admin();
        const sunrise = await as('admin@sunrise.school', 'sunrise');

        const form1 = (await post(north, '/classes', { name: 'Form 1', level: 1 }).expect(201)).body.data;
        expect((await get(sunrise, '/classes').expect(200)).body.data).toEqual([]);
        const foreign = await patch(sunrise, `/classes/${form1.id}`, { name: 'Taken over' }).expect(404);
        expect(foreign.body.error.code).toBe('CLASS_NOT_FOUND');
        await post(sunrise, `/classes/${form1.id}/sections`, { name: 'A' }).expect(404);
        await del(sunrise, `/classes/${form1.id}`).expect(404);

        // Names are unique per school only.
        await post(sunrise, '/classes', { name: 'Form 1', level: 1 }).expect(201);
        expect(fakeDb.classes.rows.map((c) => c.tenantId).sort()).toEqual([NORTHFIELD.id, SUNRISE.id].sort());
      });

      it('every change is written to the audit log of the school', async () => {
        const auth = await admin();
        const year = (await post(auth, '/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' })).body.data;
        await post(auth, `/years/${year.id}/terms`, { name: 'First Term', startDate: '2026-09-07', endDate: '2026-12-11' });
        const math = (await post(auth, '/subjects', { code: 'MATH', name: 'Mathematics' })).body.data;
        const form1 = (await post(auth, '/classes', { name: 'Form 1', level: 1 })).body.data;
        await post(auth, `/classes/${form1.id}/sections`, { name: 'A' });
        await http()
          .put(`/api/academic/classes/${form1.id}/subjects`)
          .set(auth)
          .send({ subjects: [{ subjectId: math.id, coefficient: 4 }] })
          .expect(200);

        const academic = fakeDb.audit.filter((a) => a.action.startsWith('academic.'));
        expect(academic.map((a) => a.action)).toEqual([
          'academic.year.created',
          'academic.term.created',
          'academic.subject.created',
          'academic.class.created',
          'academic.section.created',
          'academic.class.subjects_updated',
        ]);
        expect(academic.every((a) => a.tenantId === NORTHFIELD.id)).toBe(true);
        expect(academic.find((a) => a.action === 'academic.section.created')?.detail).toEqual({ name: 'Form 1 A' });

        const page = (await http().get('/api/audit?action=academic.').set(auth).expect(200)).body.data;
        expect(page.items).toHaveLength(6);
      });

      it('validates ids and bodies', async () => {
        const auth = await admin();
        await patch(auth, '/classes/not-an-id', { name: 'X' }).expect(400);
        await post(auth, '/classes', { name: 'Form 1', level: 0 }).expect(400);
        await post(auth, '/classes', { name: 'Form 1', level: 1, tenantId: SUNRISE.id }).expect(400);
        await post(auth, '/classes', { name: '   ', level: 1 }).expect(400);
        await post(auth, '/years', { name: '2026-2027' }).expect(400);
      });
    });

    describe('teacher assignment (Phase 2)', () => {
      const ASSIGN = [
        'academic.structure.manage',
        'academic.structure.view',
        'academic.teacher.assign',
        'staff.record.edit',
        'staff.record.view',
      ];
      const OTHER_ID = '99999999-9999-4999-8999-999999999999';

      async function as(email: string, school = 'northfield') {
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const admin = () => as('admin@northfield.school');
      const api = (auth: Record<string, string>) => ({
        get: (url: string) => http().get(`/api${url}`).set(auth),
        post: (url: string, body: object) => http().post(`/api${url}`).set(auth).send(body),
        put: (url: string, body: object) => http().put(`/api${url}`).set(auth).send(body),
        patch: (url: string, body: object) => http().patch(`/api${url}`).set(auth).send(body),
        del: (url: string) => http().delete(`/api${url}`).set(auth),
      });
      const assign = (auth: Record<string, string>, body: object) => api(auth).put('/teaching/assignments', body);

      /** Northfield: 2026-2027 (current), Form 1 A/B with MATH and ENG, Form 2 A with MATH; three staff. */
      async function school(auth: Record<string, string>) {
        const a = api(auth);
        const year = (await a.post('/academic/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' }).expect(201)).body.data;
        const math = (await a.post('/academic/subjects', { code: 'MATH', name: 'Mathematics' }).expect(201)).body.data;
        const eng = (await a.post('/academic/subjects', { code: 'ENG', name: 'English' }).expect(201)).body.data;
        const form1 = (await a.post('/academic/classes', { name: 'Form 1', level: 1 }).expect(201)).body.data;
        await a.post(`/academic/classes/${form1.id}/sections`, { name: 'A' }).expect(201);
        const f1 = (await a.post(`/academic/classes/${form1.id}/sections`, { name: 'B' }).expect(201)).body.data;
        await a
          .put(`/academic/classes/${form1.id}/subjects`, {
            subjects: [
              { subjectId: math.id, coefficient: 5 },
              { subjectId: eng.id, coefficient: 4 },
            ],
          })
          .expect(200);
        const form2 = (await a.post('/academic/classes', { name: 'Form 2', level: 2 }).expect(201)).body.data;
        const f2 = (await a.post(`/academic/classes/${form2.id}/sections`, { name: 'A' }).expect(201)).body.data;
        await a.put(`/academic/classes/${form2.id}/subjects`, { subjects: [{ subjectId: math.id, coefficient: 5 }] }).expect(200);

        const brenda = (await a.post('/staff', { firstName: 'Brenda', lastName: 'Ngwa', position: 'Mathematics teacher' }).expect(201)).body.data;
        const grace = (await a.post('/staff', { firstName: 'Grace', lastName: 'Mbah', position: 'English teacher' }).expect(201)).body.data;
        const peter = (await a.post('/staff', { firstName: 'Peter', lastName: 'Achu', position: 'Bursar', category: 'non_teaching' }).expect(201)).body.data;
        const [f1a, f1b] = f1.sections;
        return { year, math, eng, form1, form2, f1a, f1b, f2a: f2.sections[0], brenda, grace, peter };
      }

      beforeEach(() => {
        fakeDb.modules.push({ code: 'staff', name: 'Staff', category: 'business', dependsOn: [] });
        fakeDb.activate(NORTHFIELD.id, ['staff']);
        app.get(ModuleRegistryService).invalidateAll();
        // The administrator sets up the school and assigns teachers; the teacher reads.
        for (const role of fakeDb.roles) {
          if (role.archetype === 'admin') role.permissions = [...ADMIN_PERMISSIONS, ...ASSIGN];
          if (role.id === ROLE_TEACHER) role.permissions = [...role.permissions, 'academic.structure.view'];
        }
      });

      it('needs the Academic and Staff modules and the assign permission', async () => {
        await http().get('/api/teaching/assignments').set('X-Tenant', 'northfield').expect(401);

        const sunrise = await as('admin@sunrise.school', 'sunrise');
        expect((await api(sunrise).get('/teaching/assignments').expect(403)).body.error.code).toBe('MODULE_INACTIVE');

        const teacher = api(await as('teacher@northfield.school'));
        const empty = (await teacher.get('/teaching/assignments').expect(200)).body.data;
        expect(empty).toEqual({ year: null, sections: [], total: 0, assigned: 0 });
        expect((await teacher.get('/teaching/teachers').expect(403)).body.error.code).toBe('PERMISSION_DENIED');
        const body = { sectionId: OTHER_ID, subjectId: OTHER_ID, staffMemberId: null };
        expect((await assign(await as('teacher@northfield.school'), body).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
      });

      it('assigns, changes and removes a teacher, with an audit entry each time', async () => {
        const auth = await admin();
        const s = await school(auth);

        const set = await assign(auth, { sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);
        expect(set.body.data).toEqual({
          yearId: s.year.id,
          sectionId: s.f1a.id,
          subjectId: s.math.id,
          teacher: { id: s.brenda.id, staffNumber: s.brenda.staffNumber, fullName: 'Ngwa Brenda', active: true },
        });
        await assign(auth, { sectionId: s.f2a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);
        await assign(auth, { sectionId: s.f1a.id, subjectId: s.eng.id, staffMemberId: s.brenda.id }).expect(200);
        // Same teacher again: nothing changes, nothing logged.
        await assign(auth, { sectionId: s.f1a.id, subjectId: s.eng.id, staffMemberId: s.brenda.id }).expect(200);
        await assign(auth, { sectionId: s.f1a.id, subjectId: s.eng.id, staffMemberId: s.grace.id }).expect(200);
        expect(fakeDb.teacherAssignments.rows).toHaveLength(3);

        const grid = (await api(auth).get('/teaching/assignments').expect(200)).body.data;
        expect(grid.year).toEqual({ id: s.year.id, name: '2026-2027' });
        expect(grid.sections.map((x: { label: string }) => x.label)).toEqual(['Form 1 A', 'Form 1 B', 'Form 2 A']);
        expect(grid.sections[0].cells.map((c: any) => [c.code, c.teacher?.fullName ?? null])).toEqual([
          ['ENG', 'Mbah Grace'],
          ['MATH', 'Ngwa Brenda'],
        ]);
        expect(grid).toMatchObject({ total: 5, assigned: 3 });

        const teachers = (await api(auth).get('/teaching/teachers').expect(200)).body.data;
        expect(teachers.map((t: any) => [t.fullName, t.load])).toEqual([
          ['Mbah Grace', 1],
          ['Ngwa Brenda', 2],
        ]);

        await assign(auth, { sectionId: s.f1a.id, subjectId: s.eng.id, staffMemberId: null }).expect(200);
        await assign(auth, { sectionId: s.f1b.id, subjectId: s.eng.id, staffMemberId: null }).expect(200);
        expect(fakeDb.teacherAssignments.rows).toHaveLength(2);

        const log = fakeDb.audit.filter((a) => a.action.startsWith('teaching.'));
        expect(log.map((a) => a.action)).toEqual([
          'teaching.assignment.created',
          'teaching.assignment.created',
          'teaching.assignment.created',
          'teaching.assignment.changed',
          'teaching.assignment.removed',
        ]);
        expect(log[0]).toMatchObject({
          tenantId: NORTHFIELD.id,
          entity: 'teacher_assignment',
          detail: { year: '2026-2027', section: 'Form 1 A', subject: 'MATH', teacher: 'Ngwa Brenda' },
        });
        expect(log[3].detail).toMatchObject({ previousStaffMemberId: s.brenda.id, staffMemberId: s.grace.id });
      });

      it('refuses staff who cannot teach and subjects the class does not have', async () => {
        const auth = await admin();
        const s = await school(auth);
        const cell = { sectionId: s.f2a.id, subjectId: s.math.id };

        expect((await assign(auth, { ...cell, staffMemberId: s.peter.id }).expect(400)).body.error.code).toBe('STAFF_NOT_TEACHING');
        await api(auth).patch(`/staff/${s.grace.id}/status`, { status: 'inactive' }).expect(200);
        expect((await assign(auth, { ...cell, staffMemberId: s.grace.id }).expect(400)).body.error.code).toBe('STAFF_INACTIVE');
        const notTaught = await assign(auth, { sectionId: s.f2a.id, subjectId: s.eng.id, staffMemberId: s.brenda.id }).expect(400);
        expect(notTaught.body.error.code).toBe('SUBJECT_NOT_IN_CLASS');

        expect((await assign(auth, { ...cell, staffMemberId: OTHER_ID }).expect(404)).body.error.code).toBe('STAFF_NOT_FOUND');
        expect((await assign(auth, { ...cell, sectionId: OTHER_ID, staffMemberId: s.brenda.id }).expect(404)).body.error.code).toBe('SECTION_NOT_FOUND');
        expect((await assign(auth, { ...cell, yearId: OTHER_ID, staffMemberId: s.brenda.id }).expect(404)).body.error.code).toBe('YEAR_NOT_FOUND');
        expect((await api(auth).get(`/teaching/assignments?yearId=${OTHER_ID}`).expect(404)).body.error.code).toBe('YEAR_NOT_FOUND');

        await assign(auth, { ...cell }).expect(400);
        await assign(auth, { ...cell, staffMemberId: 'not-an-id' }).expect(400);
        await assign(auth, { ...cell, staffMemberId: s.brenda.id, tenantId: SUNRISE.id }).expect(400);
        expect(fakeDb.teacherAssignments.rows).toHaveLength(0);

        // Only active teaching staff are offered.
        const teachers = (await api(auth).get('/teaching/teachers').expect(200)).body.data;
        expect(teachers.map((t: any) => t.fullName)).toEqual(['Ngwa Brenda']);
      });

      it('needs a year: the current one, or one chosen', async () => {
        const auth = await admin();
        const s = await school(auth);
        const next = (await api(auth).post('/academic/years', { name: '2027-2028', startDate: '2027-09-06', endDate: '2028-06-30' }).expect(201)).body.data;
        await assign(auth, { yearId: next.id, sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);

        const current = (await api(auth).get('/teaching/assignments').expect(200)).body.data;
        expect(current.assigned).toBe(0);
        const planned = (await api(auth).get(`/teaching/assignments?yearId=${next.id}`).expect(200)).body.data;
        expect(planned).toMatchObject({ year: { name: '2027-2028' }, assigned: 1 });

        // No current year: a write without a year is refused.
        for (const y of fakeDb.academicYears.rows) y.isCurrent = false;
        const none = await assign(auth, { sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(400);
        expect(none.body.error.code).toBe('YEAR_REQUIRED');
      });

      it('keeps the academic structure from losing assigned classes', async () => {
        const auth = await admin();
        const a = api(auth);
        const s = await school(auth);
        await assign(auth, { sectionId: s.f1b.id, subjectId: s.eng.id, staffMemberId: s.grace.id }).expect(200);

        expect((await a.del(`/academic/sections/${s.f1b.id}`).expect(409)).body.error.code).toBe('SECTION_HAS_ASSIGNMENTS');
        const dropEng = await a.put(`/academic/classes/${s.form1.id}/subjects`, { subjects: [{ subjectId: s.math.id, coefficient: 5 }] }).expect(409);
        expect(dropEng.body.error).toMatchObject({ code: 'SUBJECT_HAS_TEACHERS', message: expect.stringContaining('English') });
        // Changing a coefficient while keeping the subject is fine.
        await a
          .put(`/academic/classes/${s.form1.id}/subjects`, {
            subjects: [
              { subjectId: s.math.id, coefficient: 6 },
              { subjectId: s.eng.id, coefficient: 3 },
            ],
          })
          .expect(200);

        const next = (await a.post('/academic/years', { name: '2027-2028', startDate: '2027-09-06', endDate: '2028-06-30' }).expect(201)).body.data;
        await assign(auth, { yearId: next.id, sectionId: s.f2a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);
        expect((await a.del(`/academic/years/${next.id}`).expect(409)).body.error.code).toBe('YEAR_HAS_ASSIGNMENTS');

        await assign(auth, { yearId: next.id, sectionId: s.f2a.id, subjectId: s.math.id, staffMemberId: null }).expect(200);
        await a.del(`/academic/years/${next.id}`).expect(200);
        await assign(auth, { sectionId: s.f1b.id, subjectId: s.eng.id, staffMemberId: null }).expect(200);
        await a.del(`/academic/sections/${s.f1b.id}`).expect(200);
      });

      it('shows a teacher their own classes through their linked staff record', async () => {
        const auth = await admin();
        const s = await school(auth);
        await assign(auth, { sectionId: s.f2a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);
        await assign(auth, { sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);
        await assign(auth, { sectionId: s.f1a.id, subjectId: s.eng.id, staffMemberId: s.grace.id }).expect(200);

        const teacher = api(await as('teacher@northfield.school'));
        const unlinked = (await teacher.get('/teaching/mine').expect(200)).body.data;
        expect(unlinked).toMatchObject({ year: { name: '2026-2027' }, staff: null, classes: [] });

        const userId = fakeDb.users.find((u) => u.email === 'teacher@northfield.school')!.id;
        await api(auth).put(`/staff/${s.brenda.id}/account`, { userId }).expect(200);
        const mine = (await teacher.get('/teaching/mine').expect(200)).body.data;
        expect(mine.staff).toMatchObject({ fullName: 'Ngwa Brenda' });
        expect(mine.classes.map((c: any) => `${c.label} ${c.code}`)).toEqual(['Form 1 A MATH', 'Form 2 A MATH']);
      });

      it('keeps assignments inside their school', async () => {
        const north = await admin();
        const s = await school(north);
        await assign(north, { sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: s.brenda.id }).expect(200);

        fakeDb.activate(SUNRISE.id, ['academic', 'staff']);
        app.get(ModuleRegistryService).invalidateAll();
        const sunrise = await as('admin@sunrise.school', 'sunrise');
        expect((await api(sunrise).get('/teaching/assignments').expect(200)).body.data.sections).toEqual([]);
        const foreign = await assign(sunrise, { sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: null }).expect(400);
        expect(foreign.body.error.code).toBe('YEAR_REQUIRED');
        const sy = (await api(sunrise).post('/academic/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' }).expect(201)).body.data;
        const away = await assign(sunrise, { yearId: sy.id, sectionId: s.f1a.id, subjectId: s.math.id, staffMemberId: null }).expect(404);
        expect(away.body.error.code).toBe('SECTION_NOT_FOUND');
        expect(fakeDb.teacherAssignments.rows.every((r) => r.tenantId === NORTHFIELD.id)).toBe(true);
      });
    });

    describe('assessments (Phase 3)', () => {
      const ADMIN_EXTRA = [
        'academic.structure.manage',
        'academic.structure.view',
        'academic.teacher.assign',
        'staff.record.edit',
        'staff.record.view',
        'assessment.create',
        'assessment.marks.enter',
        'assessment.marks.validate',
        'assessment.marks.lock',
      ];
      const ROLE_EXAM_OFFICER = 'a0000000-0000-4000-8000-000000000004';
      const OTHER_ID = '99999999-9999-4999-8999-999999999999';

      async function as(email: string, school = 'northfield') {
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const admin = () => as('admin@northfield.school');
      const api = (auth: Record<string, string>) => ({
        get: (url: string) => http().get(`/api${url}`).set(auth),
        post: (url: string, body: object = {}) => http().post(`/api${url}`).set(auth).send(body),
        put: (url: string, body: object) => http().put(`/api${url}`).set(auth).send(body),
        patch: (url: string, body: object) => http().patch(`/api${url}`).set(auth).send(body),
        del: (url: string) => http().delete(`/api${url}`).set(auth),
      });

      /**
       * Northfield 2026-2027 with two terms; Form 1 A and B study MATH and ENG.
       * The teacher's account is linked to Ngwa Brenda, who teaches MATH in Form 1 A.
       */
      async function school() {
        const a = api(await admin());
        const year = (await a.post('/academic/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' }).expect(201)).body.data;
        const first = (await a.post(`/academic/years/${year.id}/terms`, { name: 'First Term', startDate: '2026-09-07', endDate: '2026-12-11' }).expect(201)).body.data;
        const second = (await a.post(`/academic/years/${year.id}/terms`, { name: 'Second Term', startDate: '2027-01-04', endDate: '2027-03-26' }).expect(201)).body.data;
        const term1 = first.terms.find((t: any) => t.name === 'First Term');
        const term2 = second.terms.find((t: any) => t.name === 'Second Term');
        const math = (await a.post('/academic/subjects', { code: 'MATH', name: 'Mathematics' }).expect(201)).body.data;
        const eng = (await a.post('/academic/subjects', { code: 'ENG', name: 'English' }).expect(201)).body.data;
        const form1 = (await a.post('/academic/classes', { name: 'Form 1', level: 1 }).expect(201)).body.data;
        await a.post(`/academic/classes/${form1.id}/sections`, { name: 'A' }).expect(201);
        const withB = (await a.post(`/academic/classes/${form1.id}/sections`, { name: 'B' }).expect(201)).body.data;
        await a
          .put(`/academic/classes/${form1.id}/subjects`, {
            subjects: [
              { subjectId: math.id, coefficient: 5 },
              { subjectId: eng.id, coefficient: 4 },
            ],
          })
          .expect(200);
        const other = (await a.post('/academic/subjects', { code: 'HIST', name: 'History' }).expect(201)).body.data;
        const brenda = (await a.post('/staff', { firstName: 'Brenda', lastName: 'Ngwa', position: 'Mathematics teacher' }).expect(201)).body.data;
        const userId = fakeDb.users.find((u) => u.email === 'teacher@northfield.school')!.id;
        await a.put(`/staff/${brenda.id}/account`, { userId }).expect(200);
        const [f1a, f1b] = withB.sections;
        await a.put('/teaching/assignments', { sectionId: f1a.id, subjectId: math.id, staffMemberId: brenda.id }).expect(200);
        return { year, term1, term2, math, eng, other, form1, f1a, f1b };
      }

      const seq1 = (s: Awaited<ReturnType<typeof school>>, over: object = {}) => ({
        termId: s.term1.id,
        sectionId: s.f1a.id,
        subjectId: s.math.id,
        name: ' Sequence   1 ',
        heldOn: '2026-10-12',
        ...over,
      });

      beforeEach(() => {
        fakeDb.modules.push({ code: 'staff', name: 'Staff', category: 'business', dependsOn: [] });
        fakeDb.activate(NORTHFIELD.id, ['staff', 'enrollment', 'assessment']);
        app.get(ModuleRegistryService).invalidateAll();
        for (const role of fakeDb.roles) {
          if (role.archetype === 'admin') role.permissions = [...ADMIN_PERMISSIONS, ...ADMIN_EXTRA];
          if (role.id === ROLE_TEACHER) {
            role.permissions = [...role.permissions, 'academic.structure.view', 'assessment.create', 'assessment.marks.enter'];
          }
        }
        fakeDb.roles.push({
          id: ROLE_EXAM_OFFICER,
          tenantId: NORTHFIELD.id,
          name: 'Exam Officer',
          archetype: null,
          permissions: ['academic.structure.view', 'assessment.marks.validate', 'assessment.marks.lock'],
        });
        fakeDb.addUser(
          { tenantId: NORTHFIELD.id, email: 'exams@northfield.school', firstName: 'E.', lastName: 'Officer', passwordHash },
          [ROLE_EXAM_OFFICER],
        );
      });

      it('needs the Assessment module and the assessment permissions', async () => {
        const s = await school();
        await http().get('/api/assessments').set('X-Tenant', 'northfield').expect(401);
        const sunrise = await as('admin@sunrise.school', 'sunrise');
        expect((await api(sunrise).get('/assessments').expect(403)).body.error.code).toBe('MODULE_INACTIVE');

        const exams = api(await as('exams@northfield.school'));
        await exams.get('/assessments').expect(200);
        expect((await exams.post('/assessments', seq1(s)).expect(403)).body.error.code).toBe('PERMISSION_DENIED');

        const teacher = api(await as('teacher@northfield.school'));
        const created = (await teacher.post('/assessments', seq1(s)).expect(201)).body.data;
        expect((await teacher.post(`/assessments/${created.id}/validate`).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
        await teacher.post(`/assessments/${created.id}/lock`).expect(403);
      });

      it('a teacher creates assessments for their own class only', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));

        const created = (await teacher.post('/assessments', seq1(s)).expect(201)).body.data;
        expect(created).toMatchObject({
          yearId: s.year.id,
          term: { id: s.term1.id, name: 'First Term' },
          section: { id: s.f1a.id, label: 'Form 1 A' },
          subject: { id: s.math.id, code: 'MATH', name: 'Mathematics' },
          name: 'Sequence 1',
          maxScore: 20,
          weight: 1,
          heldOn: '2026-10-12',
          status: 'open',
          submittedAt: null,
        });
        const exam = (await teacher.post('/assessments', seq1(s, { name: 'Term exam', maxScore: 40, weight: 2, heldOn: null })).expect(201)).body.data;
        expect(exam).toMatchObject({ maxScore: 40, weight: 2, heldOn: null });

        expect((await teacher.post('/assessments', seq1(s, { name: 'sequence 1' })).expect(409)).body.error.code).toBe('NAME_TAKEN');
        // The same name is fine in another term.
        await teacher.post('/assessments', seq1(s, { termId: s.term2.id, heldOn: '2027-01-25' })).expect(201);

        const notMine = await teacher.post('/assessments', seq1(s, { sectionId: s.f1b.id })).expect(403);
        expect(notMine.body.error.code).toBe('NOT_YOUR_CLASS');
        await teacher.post('/assessments', seq1(s, { subjectId: s.eng.id })).expect(403);

        const a = api(await admin());
        expect((await a.post('/assessments', seq1(s, { heldOn: '2026-12-14' })).expect(400)).body.error.code).toBe('DATE_OUTSIDE_TERM');
        expect((await a.post('/assessments', seq1(s, { heldOn: '2026-02-30' })).expect(400)).body.error.code).toBe('DATE_INVALID');
        expect((await a.post('/assessments', seq1(s, { subjectId: s.other.id })).expect(400)).body.error.code).toBe('SUBJECT_NOT_IN_CLASS');
        expect((await a.post('/assessments', seq1(s, { termId: OTHER_ID })).expect(404)).body.error.code).toBe('TERM_NOT_FOUND');
        expect((await a.post('/assessments', seq1(s, { sectionId: OTHER_ID })).expect(404)).body.error.code).toBe('SECTION_NOT_FOUND');
        await a.post('/assessments', seq1(s, { maxScore: 0 })).expect(400);
        await a.post('/assessments', seq1(s, { weight: 11 })).expect(400);
        await a.post('/assessments', seq1(s, { name: '  ' })).expect(400);
        await a.post('/assessments', seq1(s, { status: 'locked' })).expect(400);
        expect(fakeDb.assessments.rows).toHaveLength(3);
      });

      it('lists the caller\'s classes: a teacher sees only theirs, the exam officer sees all', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));
        const a = api(await admin());
        await teacher.post('/assessments', seq1(s)).expect(201);
        await teacher.post('/assessments', seq1(s, { name: 'Sequence 2', heldOn: '2026-11-16' })).expect(201);
        await teacher.post('/assessments', seq1(s, { termId: s.term2.id, name: 'Sequence 3', heldOn: '2027-01-25' })).expect(201);
        await a.post('/assessments', seq1(s, { sectionId: s.f1b.id, subjectId: s.eng.id })).expect(201);

        const mine = (await teacher.get('/assessments').expect(200)).body.data;
        expect(mine.map((x: any) => `${x.section.label} ${x.subject.code} ${x.name}`)).toEqual([
          'Form 1 A MATH Sequence 1',
          'Form 1 A MATH Sequence 2',
          'Form 1 A MATH Sequence 3',
        ]);
        const all = (await api(await as('exams@northfield.school')).get('/assessments').expect(200)).body.data;
        expect(all).toHaveLength(4);
        const firstTerm = (await a.get(`/assessments?termId=${s.term1.id}`).expect(200)).body.data;
        expect(firstTerm).toHaveLength(3);
        expect((await a.get(`/assessments?sectionId=${s.f1b.id}`).expect(200)).body.data).toHaveLength(1);
        expect((await a.get('/assessments?status=locked').expect(200)).body.data).toEqual([]);
        await a.get('/assessments?status=done').expect(400);

        const english = all.find((x: any) => x.subject.code === 'ENG');
        expect((await teacher.get(`/assessments/${english.id}`).expect(403)).body.error.code).toBe('NOT_YOUR_CLASS');
        await teacher.get(`/assessments/${mine[0].id}`).expect(200);
      });

      it('goes open, submitted, validated, locked, with every step audited', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));
        const exams = api(await as('exams@northfield.school'));
        const id = (await teacher.post('/assessments', seq1(s)).expect(201)).body.data.id;

        await teacher.patch(`/assessments/${id}`, { maxScore: 30, heldOn: '2026-10-13' }).expect(200);
        expect((await exams.post(`/assessments/${id}/validate`).expect(409)).body.error.code).toBe('STATUS_INVALID');

        const submitted = (await teacher.post(`/assessments/${id}/submit`).expect(201)).body.data;
        expect(submitted.status).toBe('submitted');
        expect(submitted.submittedAt).toEqual(expect.any(String));
        expect((await teacher.patch(`/assessments/${id}`, { name: 'Changed' }).expect(409)).body.error.code).toBe('ASSESSMENT_NOT_OPEN');
        expect((await teacher.del(`/assessments/${id}`).expect(409)).body.error.code).toBe('ASSESSMENT_NOT_OPEN');

        // Sent back to the teacher, then submitted again.
        const reopened = (await exams.post(`/assessments/${id}/reopen`).expect(201)).body.data;
        expect(reopened).toMatchObject({ status: 'open', submittedAt: null });
        await teacher.post(`/assessments/${id}/submit`).expect(201);

        await exams.post(`/assessments/${id}/validate`).expect(201);
        const locked = (await exams.post(`/assessments/${id}/lock`).expect(201)).body.data;
        expect(locked.status).toBe('locked');
        expect(locked.lockedAt).toEqual(expect.any(String));
        for (const step of ['submit', 'validate', 'reopen', 'lock']) {
          const who = step === 'submit' ? teacher : exams;
          expect((await who.post(`/assessments/${id}/${step}`).expect(409)).body.error.code).toBe('STATUS_INVALID');
        }
        await api(await admin()).del(`/assessments/${id}`).expect(409);

        const log = fakeDb.audit.filter((x) => x.entity === 'assessment');
        expect(log.map((x) => x.action)).toEqual([
          'assessment.created',
          'assessment.updated',
          'assessment.submitted',
          'assessment.reopened',
          'assessment.submitted',
          'assessment.validated',
          'assessment.locked',
        ]);
        expect(log[1].detail).toMatchObject({ changed: ['maxScore', 'heldOn'] });
        expect(log[6]).toMatchObject({ tenantId: NORTHFIELD.id, detail: { section: 'Form 1 A', subject: 'MATH', from: 'validated', to: 'locked' } });
      });

      it('an open assessment can be deleted; the academic structure keeps the ones that exist', async () => {
        const s = await school();
        const a = api(await admin());
        const english = (await a.post('/assessments', seq1(s, { sectionId: s.f1b.id, subjectId: s.eng.id })).expect(201)).body.data;
        const spare = (await a.post('/assessments', seq1(s, { name: 'Spare' })).expect(201)).body.data;
        expect((await a.del(`/assessments/${spare.id}`).expect(200)).body.data).toEqual({ id: spare.id, deleted: true });
        await a.get(`/assessments/${spare.id}`).expect(404);

        expect((await a.del(`/academic/terms/${s.term1.id}`).expect(409)).body.error.code).toBe('TERM_HAS_ASSESSMENTS');
        expect((await a.del(`/academic/sections/${s.f1b.id}`).expect(409)).body.error.code).toBe('SECTION_HAS_ASSESSMENTS');
        const drop = await a.put(`/academic/classes/${s.form1.id}/subjects`, { subjects: [{ subjectId: s.math.id, coefficient: 5 }] }).expect(409);
        expect(drop.body.error.code).toBe('SUBJECT_HAS_ASSESSMENTS');

        await a.del(`/assessments/${english.id}`).expect(200);
        await a.del(`/academic/terms/${s.term2.id}`).expect(200);
      });

      it('keeps assessments inside their school', async () => {
        const s = await school();
        const id = (await api(await admin()).post('/assessments', seq1(s)).expect(201)).body.data.id;
        fakeDb.activate(SUNRISE.id, ['academic', 'assessment']);
        for (const role of fakeDb.roles) {
          if (role.id === ROLE_SUNRISE_ADMIN) role.permissions = [...ADMIN_PERMISSIONS, ...ADMIN_EXTRA];
        }
        app.get(ModuleRegistryService).invalidateAll();
        const sunrise = api(await as('admin@sunrise.school', 'sunrise'));
        expect((await sunrise.get('/assessments').expect(200)).body.data).toEqual([]);
        expect((await sunrise.get(`/assessments/${id}`).expect(404)).body.error.code).toBe('ASSESSMENT_NOT_FOUND');
        await sunrise.post(`/assessments/${id}/validate`).expect(404);
        await sunrise.post('/assessments', seq1(s)).expect(404);
      });
    });

    describe('students and enrollment (Phase 2)', () => {
      const EXTRA = [
        'academic.structure.manage',
        'academic.structure.view',
        'student.record.edit',
        'student.record.view',
        'enrollment.enroll',
        'enrollment.withdraw',
      ];
      const OTHER_ID = '99999999-9999-4999-8999-999999999999';

      async function as(email: string, school = 'northfield') {
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const api = (auth: Record<string, string>) => ({
        get: (url: string) => http().get(`/api${url}`).set(auth),
        post: (url: string, body: object = {}) => http().post(`/api${url}`).set(auth).send(body),
        patch: (url: string, body: object) => http().patch(`/api${url}`).set(auth).send(body),
        del: (url: string) => http().delete(`/api${url}`).set(auth),
      });
      const admin = async () => api(await as('admin@northfield.school'));
      const ADA = {
        firstName: ' Ada ',
        lastName: 'Abena',
        gender: 'female',
        dateOfBirth: '2014-03-02',
        placeOfBirth: ' Buea ',
        guardianName: 'Abena  Paul',
        guardianPhone: '+237 677 00 11 22',
        guardianRelationship: 'Father',
      };

      /** 2026-2027 (current); Form 1 A (capacity 3) and Form 1 B; four students. */
      async function school() {
        const a = await admin();
        const year = (await a.post('/academic/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' }).expect(201)).body.data;
        const form1 = (await a.post('/academic/classes', { name: 'Form 1', level: 1 }).expect(201)).body.data;
        await a.post(`/academic/classes/${form1.id}/sections`, { name: 'A', capacity: 3 }).expect(201);
        const both = (await a.post(`/academic/classes/${form1.id}/sections`, { name: 'B' }).expect(201)).body.data;
        const [f1a, f1b] = both.sections;
        const ada = (await a.post('/students', ADA).expect(201)).body.data;
        const bih = (await a.post('/students', { firstName: 'Clarisse', lastName: 'Bih', gender: 'female' }).expect(201)).body.data;
        const che = (await a.post('/students', { firstName: 'Daniel', lastName: 'Che', gender: 'male' }).expect(201)).body.data;
        const eto = (await a.post('/students', { firstName: 'Samuel', lastName: 'Eto', gender: 'male' }).expect(201)).body.data;
        return { a, year, form1, f1a, f1b, ada, bih, che, eto };
      }

      beforeEach(() => {
        fakeDb.activate(NORTHFIELD.id, ['enrollment']);
        app.get(ModuleRegistryService).invalidateAll();
        for (const role of fakeDb.roles) {
          if (role.archetype === 'admin') role.permissions = [...new Set([...ADMIN_PERMISSIONS, ...EXTRA])];
        }
      });

      it('needs the modules and the permissions', async () => {
        await http().get('/api/students').set('X-Tenant', 'northfield').expect(401);
        const teacher = api(await as('teacher@northfield.school'));
        await teacher.get('/students').expect(200);
        await teacher.get('/enrollment').expect(200);
        expect((await teacher.post('/students', ADA).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
        expect((await teacher.post('/enrollment', { sectionId: OTHER_ID, studentIds: [OTHER_ID] }).expect(403)).body.error.code).toBe('PERMISSION_DENIED');

        const sunrise = api(await as('admin@sunrise.school', 'sunrise'));
        await sunrise.get('/students').expect(200);
        expect((await sunrise.get('/enrollment').expect(403)).body.error.code).toBe('MODULE_INACTIVE');
      });

      it('creates students with a generated matricule, cleaned fields and an audit entry', async () => {
        const a = await admin();
        const ada = (await a.post('/students', ADA).expect(201)).body.data;
        expect(ada).toMatchObject({
          matricule: 'STU-0001',
          fullName: 'Abena Ada',
          gender: 'female',
          dateOfBirth: '2014-03-02',
          placeOfBirth: 'Buea',
          guardian: { name: 'Abena Paul', phone: '+237 677 00 11 22', relationship: 'Father' },
          status: 'active',
          current: null,
          enrollments: [],
        });
        const own = (await a.post('/students', { firstName: 'Clarisse', lastName: 'Bih', gender: 'female', matricule: ' nf/2026/ 014 ' }).expect(201)).body.data;
        expect(own).toMatchObject({ matricule: 'NF/2026/014', guardian: null, dateOfBirth: null });
        expect((await a.post('/students', { ...ADA, firstName: 'Second' }).expect(201)).body.data.matricule).toBe('STU-0002');

        expect((await a.post('/students', { ...ADA, matricule: 'stu-0001' }).expect(409)).body.error.code).toBe('MATRICULE_TAKEN');
        expect((await a.post('/students', { ...ADA, matricule: 'x' }).expect(400)).body.error.code).toBe('MATRICULE_INVALID');
        expect((await a.post('/students', { ...ADA, dateOfBirth: '2062-03-02' }).expect(400)).body.error.code).toBe('DATE_OF_BIRTH_INVALID');
        expect((await a.post('/students', { ...ADA, dateOfBirth: '2014-02-30' }).expect(400)).body.error.code).toBe('DATE_INVALID');
        expect((await a.post('/students', { ...ADA, guardianPhone: '12' }).expect(400)).body.error.code).toBe('PHONE_INVALID');
        await a.post('/students', { ...ADA, gender: 'other' }).expect(400);
        await a.post('/students', { ...ADA, firstName: ' ' }).expect(400);
        await a.post('/students', { ...ADA, fees: 50000 }).expect(400);

        const entry = fakeDb.audit.find((x) => x.action === 'student.created' && x.entityId === ada.id);
        expect(entry).toMatchObject({ tenantId: NORTHFIELD.id, entity: 'student', detail: { matricule: 'STU-0001', name: 'Abena Ada' } });
      });

      it('edits students, searches them, and keeps the changes in the audit log', async () => {
        const s = await school();
        const updated = (await s.a.patch(`/students/${s.ada.id}`, { guardianPhone: '677 99 88 77', placeOfBirth: null }).expect(200)).body.data;
        expect(updated).toMatchObject({ placeOfBirth: null, guardian: { phone: '677 99 88 77' } });
        await s.a.patch(`/students/${s.ada.id}`, { guardianPhone: '677 99 88 77' }).expect(200);
        const edits = fakeDb.audit.filter((x) => x.action === 'student.updated');
        expect(edits).toHaveLength(1);
        expect(edits[0].detail).toEqual({ matricule: 'STU-0001', changed: ['guardianPhone', 'placeOfBirth'] });
        expect((await s.a.patch(`/students/${s.bih.id}`, { matricule: 'STU-0001' }).expect(409)).body.error.code).toBe('MATRICULE_TAKEN');
        await s.a.get(`/students/${OTHER_ID}`).expect(404);

        const found = (await s.a.get('/students?search=abena%20paul').expect(200)).body.data;
        expect(found.map((x: any) => x.fullName)).toEqual(['Abena Ada']);
        const all = (await s.a.get('/students').expect(200)).body.data;
        expect(all.map((x: any) => x.fullName)).toEqual(['Abena Ada', 'Bih Clarisse', 'Che Daniel', 'Eto Samuel']);
      });

      it('enrolls students in a section, within its capacity, once per year', async () => {
        const s = await school();
        const added = (await s.a.post('/enrollment', { sectionId: s.f1a.id, studentIds: [s.che.id, s.ada.id], enrolledOn: '2026-09-07' }).expect(201)).body.data;
        expect(added.map((e: any) => [e.student.fullName, e.section.label, e.status, e.enrolledOn])).toEqual([
          ['Abena Ada', 'Form 1 A', 'active', '2026-09-07'],
          ['Che Daniel', 'Form 1 A', 'active', '2026-09-07'],
        ]);

        const again = await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [s.ada.id, s.bih.id] }).expect(409);
        expect(again.body.error).toMatchObject({ code: 'ALREADY_ENROLLED', students: [s.ada.id] });
        expect(again.body.error.message).toContain('Abena Ada');
        const full = await s.a.post('/enrollment', { sectionId: s.f1a.id, studentIds: [s.bih.id, s.eto.id] }).expect(409);
        expect(full.body.error).toMatchObject({ code: 'SECTION_FULL', free: 1 });
        expect((await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [s.bih.id, s.bih.id] }).expect(400)).body.error.code).toBe('DUPLICATE_STUDENT');
        expect((await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [OTHER_ID] }).expect(404)).body.error.code).toBe('STUDENT_NOT_FOUND');
        expect((await s.a.post('/enrollment', { sectionId: OTHER_ID, studentIds: [s.bih.id] }).expect(404)).body.error.code).toBe('SECTION_NOT_FOUND');
        const outside = await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [s.bih.id], enrolledOn: '2027-07-01' }).expect(400);
        expect(outside.body.error.code).toBe('DATE_OUTSIDE_YEAR');
        await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [] }).expect(400);
        await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: ['nope'] }).expect(400);

        await s.a.patch(`/students/${s.eto.id}/status`, { status: 'inactive' }).expect(200);
        expect((await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [s.eto.id] }).expect(400)).body.error.code).toBe('STUDENT_INACTIVE');

        const counts = (await s.a.get('/enrollment/sections').expect(200)).body.data;
        expect(counts.year).toEqual({ id: s.year.id, name: '2026-2027' });
        expect(counts.sections.map((c: any) => [c.label, c.enrolled, c.boys, c.girls, c.capacity])).toEqual([
          ['Form 1 A', 2, 1, 1, 3],
          ['Form 1 B', 0, 0, 0, null],
        ]);
        expect((await s.a.get(`/students?sectionId=${s.f1a.id}`).expect(200)).body.data.map((x: any) => x.fullName)).toEqual(['Abena Ada', 'Che Daniel']);
        expect((await s.a.get('/students?unplaced=true').expect(200)).body.data.map((x: any) => x.fullName)).toEqual(['Bih Clarisse']);
        expect(fakeDb.audit.filter((x) => x.action === 'enrollment.created')).toHaveLength(2);
      });

      it('transfers a student: the old enrollment is kept as history', async () => {
        const s = await school();
        const [ada] = (await s.a.post('/enrollment', { sectionId: s.f1a.id, studentIds: [s.ada.id], enrolledOn: '2026-09-07' }).expect(201)).body.data;

        expect((await s.a.post(`/enrollment/${ada.id}/transfer`, { sectionId: s.f1a.id }).expect(400)).body.error.code).toBe('SAME_SECTION');
        const early = await s.a.post(`/enrollment/${ada.id}/transfer`, { sectionId: s.f1b.id, on: '2026-09-06' }).expect(400);
        expect(early.body.error.code).toBe('DATE_OUTSIDE_YEAR');
        const moved = (await s.a.post(`/enrollment/${ada.id}/transfer`, { sectionId: s.f1b.id, on: '2026-10-05' }).expect(201)).body.data;
        expect(moved).toMatchObject({ section: { label: 'Form 1 B' }, status: 'active', enrolledOn: '2026-10-05' });
        expect((await s.a.post(`/enrollment/${ada.id}/transfer`, { sectionId: s.f1b.id }).expect(409)).body.error.code).toBe('ENROLLMENT_CLOSED');

        const detail = (await s.a.get(`/students/${s.ada.id}`).expect(200)).body.data;
        expect(detail.current).toMatchObject({ enrollmentId: moved.id, label: 'Form 1 B' });
        expect(detail.enrollments.map((e: any) => [e.section.label, e.status, e.enrolledOn, e.leftOn])).toEqual([
          ['Form 1 B', 'active', '2026-10-05', null],
          ['Form 1 A', 'transferred', '2026-09-07', '2026-10-05'],
        ]);
        const log = fakeDb.audit.find((x) => x.action === 'enrollment.transferred');
        expect(log?.detail).toMatchObject({ student: 'Abena Ada', from: 'Form 1 A', to: 'Form 1 B', previousEnrollmentId: ada.id });
        const history = (await s.a.get(`/enrollment?sectionId=${s.f1a.id}`).expect(200)).body.data;
        expect(history.map((e: any) => e.status)).toEqual(['transferred']);
      });

      it('withdraws a student, who can then leave the school', async () => {
        const s = await school();
        const [che] = (await s.a.post('/enrollment', { sectionId: s.f1a.id, studentIds: [s.che.id], enrolledOn: '2026-09-07' }).expect(201)).body.data;
        expect((await s.a.patch(`/students/${s.che.id}/status`, { status: 'inactive' }).expect(409)).body.error.code).toBe('STUDENT_ENROLLED');

        const left = (await s.a.post(`/enrollment/${che.id}/withdraw`, { on: '2026-11-02', reason: ' Moved  to Douala ' }).expect(201)).body.data;
        expect(left).toMatchObject({ status: 'withdrawn', leftOn: '2026-11-02', reason: 'Moved to Douala' });
        await s.a.post(`/enrollment/${che.id}/withdraw`, {}).expect(409);
        const gone = (await s.a.patch(`/students/${s.che.id}/status`, { status: 'inactive' }).expect(200)).body.data;
        expect(gone).toMatchObject({ status: 'inactive', current: null });
        expect((await s.a.get('/enrollment/sections').expect(200)).body.data.sections[0].enrolled).toBe(0);

        // Teachers can read but not withdraw.
        const [ada] = (await s.a.post('/enrollment', { sectionId: s.f1a.id, studentIds: [s.ada.id] }).expect(201)).body.data;
        await api(await as('teacher@northfield.school')).post(`/enrollment/${ada.id}/withdraw`, {}).expect(403);
      });

      it('keeps sections and years with students, and needs a current year to enroll', async () => {
        const s = await school();
        await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [s.bih.id], enrolledOn: '2026-09-07' }).expect(201);
        expect((await s.a.del(`/academic/sections/${s.f1b.id}`).expect(409)).body.error.code).toBe('SECTION_HAS_STUDENTS');
        await s.a.del(`/academic/sections/${s.f1a.id}`).expect(200);

        const next = (await s.a.post('/academic/years', { name: '2027-2028', startDate: '2027-09-06', endDate: '2028-06-30' }).expect(201)).body.data;
        await s.a.post('/enrollment', { yearId: next.id, sectionId: s.f1b.id, studentIds: [s.bih.id], enrolledOn: '2027-09-06' }).expect(201);
        expect((await s.a.del(`/academic/years/${next.id}`).expect(409)).body.error.code).toBe('YEAR_HAS_ENROLLMENTS');

        for (const y of fakeDb.academicYears.rows) y.isCurrent = false;
        expect((await s.a.post('/enrollment', { sectionId: s.f1b.id, studentIds: [s.ada.id] }).expect(400)).body.error.code).toBe('YEAR_REQUIRED');
        expect((await s.a.get('/enrollment').expect(200)).body.data).toEqual([]);
      });

      it('keeps students and enrollments inside their school', async () => {
        const s = await school();
        const [ada] = (await s.a.post('/enrollment', { sectionId: s.f1a.id, studentIds: [s.ada.id] }).expect(201)).body.data;
        fakeDb.activate(SUNRISE.id, ['academic', 'enrollment']);
        app.get(ModuleRegistryService).invalidateAll();
        const sunrise = api(await as('admin@sunrise.school', 'sunrise'));
        expect((await sunrise.get('/students').expect(200)).body.data).toEqual([]);
        expect((await sunrise.get(`/students/${s.ada.id}`).expect(404)).body.error.code).toBe('STUDENT_NOT_FOUND');
        expect((await sunrise.post(`/enrollment/${ada.id}/withdraw`, {}).expect(404)).body.error.code).toBe('ENROLLMENT_NOT_FOUND');
        expect(fakeDb.students.rows.every((r) => r.tenantId === NORTHFIELD.id)).toBe(true);
      });
    });

    describe('marks and results (Phase 3)', () => {
      const ADMIN_EXTRA = [
        'academic.structure.manage',
        'academic.structure.view',
        'academic.teacher.assign',
        'staff.record.edit',
        'staff.record.view',
        'student.record.edit',
        'enrollment.enroll',
        'enrollment.withdraw',
        'assessment.create',
        'assessment.marks.enter',
        'assessment.marks.validate',
        'assessment.marks.lock',
        'assessment.marks.override',
        'results.compute',
        'results.reportcard.generate',
      ];
      const ROLE_EXAM_OFFICER = 'a0000000-0000-4000-8000-000000000005';

      async function as(email: string, school = 'northfield') {
        const { token } = await signIn(email, school);
        return { 'X-Tenant': school, Authorization: `Bearer ${token}` };
      }
      const api = (auth: Record<string, string>) => ({
        get: (url: string) => http().get(`/api${url}`).set(auth),
        post: (url: string, body: object = {}) => http().post(`/api${url}`).set(auth).send(body),
        put: (url: string, body: object) => http().put(`/api${url}`).set(auth).send(body),
        del: (url: string) => http().delete(`/api${url}`).set(auth),
      });

      /**
       * Form 1 A (MATH coef 4, ENG coef 3) with Abena Ada, Bih Clarisse, Che Daniel;
       * Eto Samuel in Form 1 B. The teacher account is Ngwa Brenda, MATH in Form 1 A.
       */
      async function school() {
        const a = api(await as('admin@northfield.school'));
        const year = (await a.post('/academic/years', { name: '2026-2027', startDate: '2026-09-07', endDate: '2027-06-30' }).expect(201)).body.data;
        const withTerm = (await a.post(`/academic/years/${year.id}/terms`, { name: 'First Term', startDate: '2026-09-07', endDate: '2026-12-11' }).expect(201)).body.data;
        const term = withTerm.terms[0];
        const math = (await a.post('/academic/subjects', { code: 'MATH', name: 'Mathematics' }).expect(201)).body.data;
        const eng = (await a.post('/academic/subjects', { code: 'ENG', name: 'English' }).expect(201)).body.data;
        const form1 = (await a.post('/academic/classes', { name: 'Form 1', level: 1 }).expect(201)).body.data;
        await a.post(`/academic/classes/${form1.id}/sections`, { name: 'A' }).expect(201);
        const both = (await a.post(`/academic/classes/${form1.id}/sections`, { name: 'B' }).expect(201)).body.data;
        const [f1a, f1b] = both.sections;
        await a
          .put(`/academic/classes/${form1.id}/subjects`, {
            subjects: [
              { subjectId: math.id, coefficient: 4 },
              { subjectId: eng.id, coefficient: 3 },
            ],
          })
          .expect(200);
        const brenda = (await a.post('/staff', { firstName: 'Brenda', lastName: 'Ngwa', position: 'Mathematics teacher' }).expect(201)).body.data;
        const userId = fakeDb.users.find((u) => u.email === 'teacher@northfield.school')!.id;
        await a.put(`/staff/${brenda.id}/account`, { userId }).expect(200);
        await a.put('/teaching/assignments', { sectionId: f1a.id, subjectId: math.id, staffMemberId: brenda.id }).expect(200);

        const student = async (firstName: string, lastName: string, gender: string) =>
          (await a.post('/students', { firstName, lastName, gender }).expect(201)).body.data;
        const ada = await student('Ada', 'Abena', 'female');
        const bih = await student('Clarisse', 'Bih', 'female');
        const che = await student('Daniel', 'Che', 'male');
        const eto = await student('Samuel', 'Eto', 'male');
        await a.post('/enrollment', { sectionId: f1a.id, studentIds: [ada.id, bih.id, che.id], enrolledOn: '2026-09-07' }).expect(201);
        await a.post('/enrollment', { sectionId: f1b.id, studentIds: [eto.id], enrolledOn: '2026-09-07' }).expect(201);
        return { a, year, term, math, eng, f1a, f1b, ada, bih, che, eto };
      }
      type School = Awaited<ReturnType<typeof school>>;
      const create = async (who: ReturnType<typeof api>, s: School, over: object = {}) =>
        (await who.post('/assessments', { termId: s.term.id, sectionId: s.f1a.id, subjectId: s.math.id, name: 'Sequence 1', ...over }).expect(201)).body.data;
      const save = (who: ReturnType<typeof api>, id: string, marks: [string, unknown][], reason?: string) =>
        who.put(`/assessments/${id}/marks`, { marks: marks.map(([studentId, value]) => ({ studentId, value })), ...(reason ? { reason } : {}) });

      beforeEach(() => {
        fakeDb.modules.push(
          { code: 'staff', name: 'Staff', category: 'business', dependsOn: [] },
          { code: 'results', name: 'Results', category: 'business', dependsOn: ['assessment'] },
        );
        fakeDb.activate(NORTHFIELD.id, ['staff', 'enrollment', 'assessment', 'results']);
        app.get(ModuleRegistryService).invalidateAll();
        for (const role of fakeDb.roles) {
          if (role.archetype === 'admin') role.permissions = [...new Set([...ADMIN_PERMISSIONS, ...ADMIN_EXTRA])];
          if (role.id === ROLE_TEACHER) {
            role.permissions = [...role.permissions, 'academic.structure.view', 'assessment.create', 'assessment.marks.enter'];
          }
        }
        fakeDb.roles.push({
          id: ROLE_EXAM_OFFICER,
          tenantId: NORTHFIELD.id,
          name: 'Exam Officer',
          archetype: null,
          permissions: [
            'academic.structure.view',
            'assessment.marks.validate',
            'assessment.marks.lock',
            'assessment.marks.override',
            'results.compute',
            'results.reportcard.generate',
          ],
        });
        fakeDb.addUser(
          { tenantId: NORTHFIELD.id, email: 'exams@northfield.school', firstName: 'E.', lastName: 'Officer', passwordHash },
          [ROLE_EXAM_OFFICER],
        );
      });

      it('the teacher fills the mark sheet of their class, then submits it complete', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));
        const seq = await create(teacher, s);

        const empty = (await teacher.get(`/assessments/${seq.id}/marks`).expect(200)).body.data;
        expect(empty.students.map((l: any) => [l.fullName, l.score, l.absent, l.inSection])).toEqual([
          ['Abena Ada', null, false, true],
          ['Bih Clarisse', null, false, true],
          ['Che Daniel', null, false, true],
        ]);
        expect(empty).toMatchObject({ editing: 'open', summary: { students: 3, missing: 3, average: null } });

        const bad = await save(teacher, seq.id, [[s.ada.id, '21'], [s.bih.id, 'twelve'], [s.che.id, '10']]).expect(400);
        expect(bad.body.error.code).toBe('MARKS_INVALID');
        expect(bad.body.error.errors.map((e: any) => [e.studentId, e.code])).toEqual([
          [s.ada.id, 'MARK_OUT_OF_RANGE'],
          [s.bih.id, 'MARK_INVALID'],
        ]);
        expect(fakeDb.marks.rows).toHaveLength(0);
        expect((await save(teacher, seq.id, [[s.eto.id, 10]]).expect(400)).body.error.code).toBe('STUDENT_NOT_IN_SECTION');
        expect((await save(teacher, seq.id, [[s.ada.id, 10], [s.ada.id, 11]]).expect(400)).body.error.code).toBe('DUPLICATE_STUDENT');

        const sheet = (await save(teacher, seq.id, [[s.ada.id, '12,5'], [s.bih.id, 'abs']]).expect(200)).body.data;
        expect(sheet.students.map((l: any) => [l.score, l.absent])).toEqual([[12.5, false], [null, true], [null, false]]);
        expect(sheet.summary).toMatchObject({ marked: 1, absent: 1, missing: 1, average: 12.5 });

        const incomplete = await teacher.post(`/assessments/${seq.id}/submit`).expect(409);
        expect(incomplete.body.error).toMatchObject({ code: 'MARKS_INCOMPLETE', missing: [s.che.id] });
        await save(teacher, seq.id, [[s.che.id, 9]]).expect(200);
        // Clearing a cell removes the mark.
        await save(teacher, seq.id, [[s.che.id, '']]).expect(200);
        expect(fakeDb.marks.rows).toHaveLength(2);
        await save(teacher, seq.id, [[s.che.id, 9]]).expect(200);
        await teacher.post(`/assessments/${seq.id}/submit`).expect(201);

        const closed = await save(teacher, seq.id, [[s.che.id, 10]]).expect(409);
        expect(closed.body.error.code).toBe('ASSESSMENT_NOT_OPEN');
        expect((await teacher.get(`/assessments/${seq.id}/marks`).expect(200)).body.data.editing).toBe('closed');

        // Another class: not the teacher's.
        const english = await create(s.a, s, { subjectId: s.eng.id });
        expect((await teacher.get(`/assessments/${english.id}/marks`).expect(403)).body.error.code).toBe('NOT_YOUR_CLASS');
        expect((await save(teacher, english.id, [[s.ada.id, 10]]).expect(403)).body.error.code).toBe('NOT_YOUR_CLASS');

        // Four saves changed something: the first two marks, Che 9, Che cleared, Che 9 again.
        const saved = fakeDb.audit.filter((x) => x.action === 'assessment.marks.saved');
        expect(saved).toHaveLength(4);
        expect(saved[0].detail).toMatchObject({ name: 'Sequence 1', section: 'Form 1 A', subject: 'MATH', changed: 2 });
      });

      it('a locked mark changes only by override, with a reason, and is audited', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));
        const exams = api(await as('exams@northfield.school'));
        const seq = await create(teacher, s);
        await save(teacher, seq.id, [[s.ada.id, 14], [s.bih.id, 11], [s.che.id, 'ABS']]).expect(200);
        await teacher.post(`/assessments/${seq.id}/submit`).expect(201);
        await exams.post(`/assessments/${seq.id}/validate`).expect(201);
        await exams.post(`/assessments/${seq.id}/lock`).expect(201);

        expect((await exams.get(`/assessments/${seq.id}/marks`).expect(200)).body.data.editing).toBe('override');
        expect((await save(teacher, seq.id, [[s.ada.id, 15]]).expect(403)).body.error.code).toBe('MARKS_LOCKED');
        expect((await save(exams, seq.id, [[s.ada.id, 15]]).expect(400)).body.error.code).toBe('OVERRIDE_REASON_REQUIRED');
        expect((await save(exams, seq.id, [[s.ada.id, 15]], 'short').expect(400)).body.error.code).toBe('OVERRIDE_REASON_REQUIRED');

        const fixed = (await save(exams, seq.id, [[s.ada.id, 15], [s.che.id, 7]], 'Script re-marked after appeal').expect(200)).body.data;
        expect(fixed.students.map((l: any) => l.score)).toEqual([15, 11, 7]);
        expect(fixed.assessment.status).toBe('locked');
        const overrides = fakeDb.audit.filter((x) => x.action === 'assessment.mark.overridden');
        expect(overrides.map((x) => x.detail)).toEqual([
          expect.objectContaining({ student: 'Abena Ada', before: 14, after: 15, reason: 'Script re-marked after appeal' }),
          expect.objectContaining({ student: 'Che Daniel', before: 'ABS', after: 7 }),
        ]);
      });

      it('a student who changes section keeps their mark on the sheet; only the current class must be complete', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));
        const seq = await create(teacher, s);
        await save(teacher, seq.id, [[s.che.id, 13]]).expect(200);
        const enrollment = fakeDb.enrollments.rows.find((e) => e.studentId === s.che.id)!;
        await s.a.post(`/enrollment/${enrollment.id}/transfer`, { sectionId: s.f1b.id, on: '2026-10-05' }).expect(201);

        const sheet = (await teacher.get(`/assessments/${seq.id}/marks`).expect(200)).body.data;
        expect(sheet.students.map((l: any) => [l.fullName, l.inSection, l.score])).toEqual([
          ['Abena Ada', true, null],
          ['Bih Clarisse', true, null],
          ['Che Daniel', false, 13],
        ]);
        expect(sheet.summary).toMatchObject({ students: 2, missing: 2, marked: 1 });
        await save(teacher, seq.id, [[s.ada.id, 10], [s.bih.id, 12]]).expect(200);
        await teacher.post(`/assessments/${seq.id}/submit`).expect(201);
      });

      it('computes results from locked assessments, or a provisional preview', async () => {
        const s = await school();
        const exams = api(await as('exams@northfield.school'));
        const teacher = api(await as('teacher@northfield.school'));
        const lockWith = async (over: object, marks: [string, unknown][], who = teacher, lock = true) => {
          const x = await create(who, s, over);
          await save(who, x.id, marks).expect(200);
          await who.post(`/assessments/${x.id}/submit`).expect(201);
          if (lock) {
            await exams.post(`/assessments/${x.id}/validate`).expect(201);
            await exams.post(`/assessments/${x.id}/lock`).expect(201);
          }
          return x;
        };
        await lockWith({}, [[s.ada.id, 16], [s.bih.id, 'ABS'], [s.che.id, 8]]);
        await lockWith({ name: 'Sequence 2', maxScore: 40, weight: 2 }, [[s.ada.id, 30], [s.bih.id, 36], [s.che.id, 12]]);
        await lockWith({ subjectId: s.eng.id }, [[s.ada.id, 12], [s.bih.id, 9], [s.che.id, 14]], s.a, false);
        await create(teacher, s, { name: 'Sequence 3' });

        const url = `/results?termId=${s.term.id}&sectionId=${s.f1a.id}`;
        const official = (await exams.get(url).expect(200)).body.data;
        expect(official).toMatchObject({
          year: { name: '2026-2027' },
          term: { name: 'First Term' },
          section: { label: 'Form 1 A' },
          provisional: false,
          pending: 2,
        });
        expect(official.counted).toHaveLength(2);
        expect(official.results.students.map((x: any) => [x.student.fullName, x.average, x.rank])).toEqual([
          ['Bih Clarisse', 18, 1],
          ['Abena Ada', 15.33, 2],
          ['Che Daniel', 6.67, 3],
        ]);
        expect(official.results.stats).toMatchObject({ size: 3, classAverage: 13.33, passRate: 66.7 });
        const mathLine = official.results.students[1].subjects.find((l: any) => l.code === 'MATH');
        expect(mathLine).toMatchObject({ coefficient: 4, teacher: 'Ngwa Brenda', average: 15.33, rank: 2 });
        expect(official.results.students[1].subjects.find((l: any) => l.code === 'ENG')).toMatchObject({ average: null, teacher: null });

        const preview = (await exams.get(`${url}&provisional=true`).expect(200)).body.data;
        expect(preview).toMatchObject({ provisional: true, pending: 1 });
        expect(preview.results.students.map((x: any) => [x.student.fullName, x.average, x.rank])).toEqual([
          ['Bih Clarisse', 14.14, 1],
          ['Abena Ada', 13.9, 2],
          ['Che Daniel', 9.81, 3],
        ]);

        const cards = (await exams.get(`/results/report-cards?termId=${s.term.id}&sectionId=${s.f1a.id}`).expect(200)).body.data;
        expect(cards).toHaveLength(3);
        expect(cards[0]).toMatchObject({
          school: { name: NORTHFIELD.name },
          section: { label: 'Form 1 A' },
          result: { student: { fullName: 'Bih Clarisse' }, rank: 1 },
          stats: { classified: 3 },
        });

        expect((await teacher.get(url).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
        await exams.get(`/results?termId=${s.term.id}`).expect(400);
        const sunrise = api(await as('admin@sunrise.school', 'sunrise'));
        expect((await sunrise.get(url).expect(403)).body.error.code).toBe('MODULE_INACTIVE');
      });

      it('deleting an open assessment deletes its marks', async () => {
        const s = await school();
        const teacher = api(await as('teacher@northfield.school'));
        const seq = await create(teacher, s);
        await save(teacher, seq.id, [[s.ada.id, 14], [s.bih.id, 11]]).expect(200);
        await teacher.del(`/assessments/${seq.id}`).expect(200);
        expect(fakeDb.marks.rows).toHaveLength(0);
      });
    });
  });
});
