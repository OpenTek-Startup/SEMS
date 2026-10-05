# YESE Backend Skeleton — Setup from Scratch

Build the NestJS backend skeleton and push it to GitHub.

## What this skeleton contains
- NestJS + TypeScript backend
- @nestjs/config (env loading)
- Prisma ORM connected to Neon PostgreSQL
- Global ValidationPipe, exception filter, response interceptor, CORS
- A `modules/` folder for business modules (Phases 1+)
- A working `GET /api/health` endpoint that pings the database

## Final structure
```
backend/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── common/
│   │   ├── filters/all-exceptions.filter.ts
│   │   └── interceptors/transform.interceptor.ts
│   ├── config/configuration.ts
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── modules/
│   │   └── health/
│   │       ├── health.controller.ts
│   │       ├── health.service.ts
│   │       └── health.module.ts
│   ├── app.module.ts
│   └── main.ts
├── .env            (you create — holds secrets, git-ignored)
└── .env.example
```

---

## STEP 1 — Prerequisites
```bash
node -v      # v20+
pnpm -v      # install with: npm install -g pnpm
git -v
```

## STEP 2 — Create the repo & scaffold NestJS
```bash
mkdir yese && cd yese
git init
pnpm dlx @nestjs/cli new backend --package-manager pnpm --skip-git
```

## STEP 3 — Add dependencies
```bash
cd backend
pnpm add @nestjs/config class-validator class-transformer @prisma/client
pnpm add -D prisma
```

## STEP 4 — Drop in the skeleton files
Copy the contents of this kit's `src/` and `prisma/` folders into `backend/`,
and copy `.env.example` into `backend/`. Then DELETE the three default files
NestJS generated (we replaced them with the health module):
```bash
rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts
```

## STEP 5 — Configure environment
```bash
cp .env.example .env
```
Open `.env` and paste your Neon strings:
- `DATABASE_URL` = the POOLED string (host has `-pooler`)
- `DIRECT_URL`   = the DIRECT string (host has no `-pooler`)

## STEP 6 — First Prisma migration (proves DB connection)
```bash
npx prisma migrate dev --name init
```
Creates the `Tenant` table in Neon and generates the Prisma client.
Verify visually:
```bash
npx prisma studio     # http://localhost:5555
```

## STEP 7 — Run the backend
```bash
pnpm start:dev
```
Open http://localhost:3001/api/health — you should see:
```json
{ "success": true, "data": { "status": "ok", "database": "connected", ... } }
```
That confirms NestJS + Prisma + Neon all work together.

## STEP 8 — Git ignore + first commit
Put `.gitignore` at the REPO ROOT (yese/). Use the `gitignore.txt` from this
kit, renamed to `.gitignore`. Then:
```bash
cd ..                # repo root (yese/)
git add .
git commit -m "feat(backend): NestJS skeleton with Prisma/Neon and health check"
```
Note: DO commit `backend/prisma/migrations/`. NEVER commit `.env`.

## STEP 9 — Push to GitHub
Create an EMPTY repo on github.com named `yese` (no README/gitignore), then:
```bash
git branch -M main
git remote add origin https://github.com/<your-username>/yese.git
git push -u origin main
```
Or with the GitHub CLI:
```bash
gh repo create yese --private --source=. --remote=origin --push
```

Done — the backend skeleton is live on GitHub. Next: Phase 1 (Tenant → Auth → RBAC).
