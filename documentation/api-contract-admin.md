# YESE API contract — Permissions & school administration (Step 4)

Same base URL, school header and response shapes as the auth contract.
Every route below needs a signed-in user of the school **and** a permission.

## How permissions work

- Each route is tagged with `@RequirePermission(...codes)`. The caller needs
  **at least one** of the listed codes. A platform Super Admin bypasses the check.
- A route with no `@RequirePermission` only needs a signed-in user.
- Permission codes are `module.resource.action` and come from the seed catalogue.
  The core ones: `core.user.view`, `core.user.manage`, `core.role.manage`,
  `core.settings.manage`, `core.audit.view`.
- Missing permission → **403** `{ error: { code: "PERMISSION_DENIED", message } }`.

## Endpoints

| Method | Path | Permission | Body | Returns |
|---|---|---|---|---|
| GET | `/admin/users` | `core.user.view` or `core.user.manage` | — | `AdminUser[]` |
| GET | `/admin/users/:id` | `core.user.view` or `core.user.manage` | — | `AdminUser` |
| POST | `/admin/users` | `core.user.manage` | `{ email, firstName, lastName, roleIds? }` | `{ user, temporaryPassword }` |
| PUT | `/admin/users/:id/status` | `core.user.manage` | `{ status: "active" \| "disabled" }` | `AdminUser` |
| PUT | `/admin/users/:id/roles` | `core.role.manage` | `{ roleIds: string[] }` | `AdminUser` |
| POST | `/admin/users/:id/reset-password` | `core.user.manage` | — | `{ temporaryPassword }` |
| GET | `/admin/roles` | `core.user.view` / `manage` / `role.manage` | — | `SchoolRole[]` |

### `AdminUser`

```json
{
  "id": "uuid",
  "email": "teacher@northfield.school",
  "firstName": "T",
  "lastName": "Teacher",
  "status": "active",
  "mustChangePassword": false,
  "isSuperAdmin": false,
  "lastLoginAt": "2026-10-12T08:00:00.000Z",
  "roles": [{ "id": "uuid", "name": "Staff / Teacher", "archetype": "staff" }]
}
```

`SchoolRole`: `{ id, name, description, archetype, isSystem }`.

## Rules worth knowing

- **One-time passwords.** Create and reset return a `temporaryPassword` once, in
  the response body only. Show it to the admin, never store it. The user has
  `mustChangePassword = true` and must change it at next sign-in.
- **Create / reset / disable end the user's sessions** so a change takes effect at once.
- **Role change takes effect on the next request** (the permission cache is dropped).
- **You cannot disable or re-role your own account** → 403 `FORBIDDEN_SELF`.
- **School isolation**: all reads and writes go through the school-scoped client,
  so an id from another school is never found (reads) or rejected (role assignment).

## Error codes (in addition to the auth ones)

| HTTP | `error.code` | When |
|---|---|---|
| 403 | `PERMISSION_DENIED` | caller lacks the required permission |
| 403 | `FORBIDDEN_SELF` | admin tried to change their own status or roles |
| 400 | `EMAIL_IN_USE` | a user with that email already exists in the school |
| 400 | `INVALID_ROLES` | a role id is not a role of this school |
| 400 | `NOT_FOUND` | no such user in this school |

## Audit entries

`admin.user.created`, `admin.user.status_changed`, `admin.user.roles_changed`,
`admin.user.password_reset`.
