# YESE — OpenTek School Enterprise Management System

Multi-tenant, modular school ERP (SEMS-ERP), built as a NestJS modular monolith
with a Next.js frontend and PostgreSQL (Neon).

| Folder | What it is |
|---|---|
| `backend/` | NestJS + Prisma API, served under `/api` (port 3001) |
| `frontend/` | Next.js + Redux Toolkit + Tailwind app (port 3000) |
| `documentation/` | SRS, data model / ERDs, implementation timeline, mockups |

## Run it locally

Requirements: Node.js 22+, pnpm.

```bash
# 1. Backend
cd backend
cp .env.example .env        # then paste your Neon DATABASE_URL and DIRECT_URL, and a JWT_SECRET
pnpm install                # also generates the Prisma client
pnpm db:status              # checks the database connection and migrations
pnpm start:dev              # http://localhost:3001/api/health

# 2. Frontend (second terminal)
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev                    # http://localhost:3000 shows the system status
```

The home page shows whether the frontend, backend and database are all connected.

## Useful commands

| Where | Command | Does |
|---|---|---|
| backend | `pnpm test` / `pnpm test:e2e` | unit / API tests (no database needed) |
| backend | `pnpm db:migrate` | create and apply a migration after editing `prisma/schema.prisma` |
| backend | `pnpm db:studio` | browse the database |
| frontend | `pnpm lint` / `pnpm typecheck` | lint / type-check |

## Working together

- Branch from `main` (`feature/<short-name>`, `fix/<short-name>`) and open a pull request.
- CI (GitHub Actions) must pass, and the other developer reviews before merging.
- Commit messages: `feat(backend): …`, `fix(frontend): …`, `chore: …`.
- Never commit `.env` files or the generated Prisma client (`backend/src/generated/`).
