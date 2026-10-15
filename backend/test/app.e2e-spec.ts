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
}

describe('YESE API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        tenant: { findUnique: findTenant },
        user: fakeDb.user,
        session: fakeDb.session,
        auditLog: fakeDb.auditLog,
      })
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
      id: '11111111-1111-1111-1111-111111111111',
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
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'northfield',
      name: 'School northfield',
      type: 'secondary',
      status: 'active',
    };
    const SUNRISE = {
      id: '22222222-2222-2222-2222-222222222222',
      slug: 'sunrise',
      name: 'School sunrise',
      type: 'secondary',
      status: 'active',
    };
    const PASSWORD = 'Northfield2026';
    const ROLE_ADMIN = 'a0000000-0000-4000-8000-000000000001';
    const ROLE_TEACHER = 'a0000000-0000-4000-8000-000000000002';
    const ROLE_SUNRISE_ADMIN = 'a0000000-0000-4000-8000-000000000003';
    const ADMIN_PERMISSIONS = ['core.role.manage', 'core.user.manage', 'core.user.view', 'student.record.view'];
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
      fakeDb.tenants = [NORTHFIELD, SUNRISE];
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
      findTenant.mockImplementation(({ where }: { where: { slug: string } }) =>
        Promise.resolve([NORTHFIELD, SUNRISE].find((t) => t.slug === where.slug) ?? null),
      );
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
  });
});
