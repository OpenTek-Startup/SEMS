# YESE API contract — Permissions and user administration (Step 4)

Same base URL, school header and response shapes as `api-contract-auth.md`.
Every route below needs a signed-in user (Bearer token) AND the permission shown.
Missing permission -> `403` with `error.code = "PERMISSION_DENIED"`.
Permissions are read on every request, so a role change applies immediately.

| Method | Path | Permission | Body | Returns |
|---|---|---|---|---|
| GET | `/users` | `core.user.view` | — | `SchoolUser[]` (this school only, sorted by name) |
| GET | `/roles` | `core.user.view` | — | `SchoolRole[]` (this school only) |
| POST | `/users` | `core.user.manage` | `{ email, firstName, lastName, roleIds: uuid[] }` | `201 { user, temporaryPassword }` |
| PATCH | `/users/:id/status` | `core.user.manage` | `{ status: "active" \| "disabled" }` | `SchoolUser` |
| PUT | `/users/:id/roles` | `core.role.manage` | `{ roleIds: uuid[] }` (replaces all roles) | `SchoolUser` |
| POST | `/users/:id/reset-password` | `core.user.manage` | — | `{ user, temporaryPassword }` |

### `SchoolUser`

```json
{
  "id": "uuid",
  "email": "teacher@northfield.school",
  "firstName": "R.",
  "lastName": "Fon",
  "status": "active",
  "mustChangePassword": false,
  "lastLoginAt": "2026-10-14T08:12:00.000Z",
  "createdAt": "2026-10-10T18:00:00.000Z",
  "roles": [{ "id": "uuid", "name": "Staff / Teacher", "archetype": "staff" }]
}
```

### `SchoolRole`

```json
{ "id": "uuid", "name": "Exam Officer", "description": "…", "archetype": null, "isSystem": false,
  "permissions": ["assessment.marks.lock", "…"] }
```

## Rules

- **One-time password:** creating a user or resetting a password returns `temporaryPassword` once
  (e.g. `Kp7m-x9Qa-2Rbt`). The user must change it at first sign-in. It is never stored in clear.
- **Reset and disable sign the user out everywhere** (their sessions are revoked).
- **Other schools are invisible:** a user or role id from another school gives `404 USER_NOT_FOUND`
  or `400 UNKNOWN_ROLE`, never data.
- **No self-lockout:** an administrator cannot disable, change the roles of, or reset their own account
  (`400 CANNOT_CHANGE_SELF`); they use "Change password" for themselves.
- **Email is unique per school:** `409 EMAIL_TAKEN`.

## Error codes added in Step 4

| HTTP | `error.code` | When |
|---|---|---|
| 403 | `PERMISSION_DENIED` | the user's roles do not grant the route's permission |
| 400 | `UNKNOWN_ROLE` | a role id is not a role of this school |
| 400 | `CANNOT_CHANGE_SELF` | acting on your own account |
| 400 | `SCHOOL_REQUIRED` | no school in the request |
| 404 | `USER_NOT_FOUND` | no such user in this school |
| 409 | `EMAIL_TAKEN` | email already used in this school |

## Audit entries written

`user.created`, `user.disabled`, `user.enabled`, `user.roles.updated`, `user.password.reset`.

## Frontend helpers

- `can(user, "core.user.manage")` / `useCan(...)` in `frontend/src/lib/auth/permissions.ts`.
- `frontend/src/lib/api/usersApi.ts` has RTK Query hooks for every route above.
- `AppHeader` (`frontend/src/components/layout/AppHeader.tsx`) hides menu entries the user cannot use.
