# YESE API contract — Module Registry (Phase 1.5)

Same base URL and response shapes as `api-contract-auth.md`.

## Rules (FR-PL-03, FR-ID-06)

- **Core** modules (`category = "core"`) are always on and cannot be switched off.
- A module can be switched on only when every module in its `dependsOn` is on
  (`409 MODULE_DEPENDENCY_INACTIVE`, `error.missing` lists them).
- A module can be switched off only when no active module depends on it
  (`409 MODULE_REQUIRED_BY`, `error.dependents` lists them).
- Routes of an inactive module answer `403 MODULE_INACTIVE` (backend: `@RequireModule('code')`).
- Permissions of an inactive module are **not effective**: they disappear from
  `/auth/me` and `/roles`, and `@RequirePermission` refuses them.
- Every change is audited for that school: `module.activated` / `module.deactivated` (`detail.module`).

## Dependencies (seed)

| Module | Needs |
|---|---|
| student, staff, academic | — |
| enrollment | student, academic |
| attendance | enrollment |
| assessment | academic, enrollment |
| results | assessment |
| finance | student |
| comms | student |

Demo activations: Northfield runs student, staff, academic, enrollment, attendance, assessment, results; Sunrise runs student, staff, academic.

## School side — any signed-in school user

`GET /modules` →
```json
[{ "code": "academic", "name": "Academic structure", "category": "business", "description": "…",
   "dependsOn": [], "core": false, "active": true }]
```
Frontend: `useActiveModules()` / `useModuleActive('attendance')` in `frontend/src/lib/modules/useModules.ts`.

## Platform side — Super Admin only (signed in with no school), else `403 SUPER_ADMIN_ONLY`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/platform/modules` | — | catalogue: `{ code, name, category, description, dependsOn }[]` |
| GET | `/platform/schools` | — | `{ id, slug, name, type, status, activeModules: string[] }[]` |
| PUT | `/platform/schools/:id/modules/:code` | `{ active: true \| false }` | the school with its new `activeModules` |

Other errors: `404 SCHOOL_NOT_FOUND`, `404 MODULE_NOT_FOUND`, `400 MODULE_CORE`, `400` for a non-boolean `active`.

## For new modules (Phase 2 onwards)

1. Add the module and its `dependsOn` to `prisma/seed.ts` (`MODULES`), and its permissions (`module.resource.action`).
2. Put `@RequireModule('<code>')` on the module's controller, next to `@RequirePermission(...)` on each route.
3. In the frontend, hide its menu with `useModuleActive('<code>')`.
