import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `pnpm db:seed` runs this (idempotent dev data: modules, permissions,
    // Super Admin, two demo schools, base roles, school admins).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
