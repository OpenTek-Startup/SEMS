# YESE API contract — Authentication (Step 3)

Base URL: `http://localhost:3001/api` (development). Every request names the school:
`X-Tenant: northfield` in development, the subdomain (`northfield.yese.app`) in production.
The platform Super Admin sends no school.

All responses use the global shapes:

- success: `{ "success": true, "data": … }`
- error: `{ "success": false, "statusCode", "path", "timestamp", "error": { "code", "message" } }`

Every route requires a signed-in user unless it is marked `@Public()` in the backend
(public today: `/health`, `/tenant/current`, `/auth/login`, `/auth/refresh`, `/auth/logout`).

## Endpoints

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/login` | — | `{ email, password }` | `{ accessToken, expiresIn, user }` + refresh cookie |
| POST | `/auth/refresh` | refresh cookie | — | `{ accessToken, expiresIn, user }` + NEW refresh cookie |
| POST | `/auth/logout` | refresh cookie | — | `{ signedOut: true }`, cookie cleared |
| GET | `/auth/me` | Bearer | — | `user` |
| POST | `/auth/change-password` | Bearer | `{ currentPassword, newPassword }` | `user` |

- Access token: JWT, `Authorization: Bearer <token>`, lifetime `expiresIn` seconds (15 min). Keep it in memory only.
- Refresh token: httpOnly cookie `yese_rt`, path `/api/auth`, SameSite=Lax (Secure in production).
  It changes on every refresh. Fetch with `credentials: "include"`.
- Sessions end after 15 minutes without activity, and after 12 hours in any case.

### `user`

```json
{
  "id": "uuid",
  "email": "admin@northfield.school",
  "firstName": "M.",
  "lastName": "Ndzana",
  "isSuperAdmin": false,
  "mustChangePassword": true,
  "school": { "id": "uuid", "slug": "northfield", "name": "Northfield Bilingual College" },
  "roles": [{ "id": "uuid", "name": "Administrator", "archetype": "admin" }],
  "permissions": ["core.audit.view", "core.user.view", "…"]
}
```

`school` is `null` for the Super Admin. `archetype` is `admin | staff | parent | student`, or `null` for a custom role.

## Error codes

| HTTP | `error.code` | When | Frontend reaction |
|---|---|---|---|
| 400 | (validation) | malformed body | show message |
| 400 | `WRONG_CURRENT_PASSWORD` | change-password, current password wrong | show message |
| 400 | `WEAK_PASSWORD` | new password breaks the policy (8+ chars, a letter, a number) | show message list |
| 401 | `INVALID_CREDENTIALS` | wrong email or password (same message for both) | show message |
| 401 | `NOT_SIGNED_IN`, `TOKEN_EXPIRED`, `TOKEN_INVALID` | missing/expired/bad access token | refresh once, retry |
| 401 | `WRONG_SCHOOL` | token or session from another school | sign out |
| 401 | `SESSION_ENDED`, `SESSION_EXPIRED`, `SESSION_IDLE` | signed out, 12 h reached, 15 idle minutes | go to /login with the message |
| 401 | `REFRESH_TOKEN_MISSING`, `REFRESH_TOKEN_INVALID` | no or unknown refresh cookie | go to /login |
| 401 | `REFRESH_TOKEN_REUSED` | an old refresh token was replayed: session ended | go to /login with the message |
| 403 | `ACCOUNT_DISABLED` | account disabled | show message |
| 403 | `PASSWORD_CHANGE_REQUIRED` | any route except `/auth/me` and `/auth/change-password` while the password must be changed | go to /change-password |
| 403 | (no code) | school suspended (from tenant resolution) | show message |
| 404 | (no code) | unknown school | show message |
| 429 | `TOO_MANY_ATTEMPTS` | 5 failed sign-ins for this email + IP + school in 15 minutes | show message |

## Audit entries written

`auth.login.success`, `auth.login.failed`, `auth.login.blocked`, `auth.logout`,
`auth.password.changed`, `auth.password.change_failed`, `auth.session.idle_timeout`,
`auth.refresh.reused`.
