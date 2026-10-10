import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

// The e2e suite runs without a real database (also in CI):
// the Prisma client is replaced by a fake whose query we control.
const queryRaw = jest.fn();
const findTenant = jest.fn();
jest.mock('./../src/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('YESE API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw, tenant: { findUnique: findTenant } })
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
});
