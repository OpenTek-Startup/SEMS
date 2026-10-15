# YESE API contract — Audit log (Step 5)

Same base URL, school header and response shapes as `api-contract-auth.md`.

## `GET /audit` — permission `core.audit.view`

Events of the **current school only**, newest first. Platform events (seed, Super Admin)
and other schools' events are never returned. Entries are append-only: there is no
route to edit or delete them.

| Query parameter | Example | Meaning |
|---|---|---|
| `action` | `auth.` / `user.` | a category: every action starting with it |
|  | `user.created` | one exact action |
| `actorUserId` | uuid | only what this person did |
| `from` | `2026-10-01` | from the start of that day (UTC); a full ISO date-time is also accepted |
| `to` | `2026-10-15` | up to the end of that day (UTC) |
| `page` | `1` | default 1 |
| `pageSize` | `25` | default 25, max 100 |

Unknown parameters, a bad id or date, `from` after `to` (`INVALID_FILTER`) or `pageSize` > 100 → `400`.

### Response

```json
{
  "items": [
    {
      "id": "uuid",
      "action": "user.password.reset",
      "createdAt": "2026-10-15T21:40:12.000Z",
      "ipAddress": "::1",
      "actor":  { "id": "uuid", "name": "M. Ndzana", "email": "admin@northfield.school" },
      "entity": "user",
      "entityId": "uuid",
      "target": { "id": "uuid", "name": "R. Fon", "email": "teacher@northfield.school" },
      "detail": null
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 1
}
```

- `actor` is `null` when nobody is known, e.g. a failed sign-in with an unknown email (`detail.email` says which).
- `target` is filled when the event is about a user (`entity = "user"`).

## Actions recorded so far

| Action | When |
|---|---|
| `auth.login.success` / `auth.login.failed` / `auth.login.blocked` | sign-in, failed sign-in (`detail.reason`), 5 failures in 15 min |
| `auth.logout` | sign-out |
| `auth.password.changed` / `auth.password.change_failed` | own password change |
| `auth.session.idle_timeout` | signed out after 15 idle minutes |
| `auth.refresh.reused` | an old refresh token was replayed; session ended |
| `user.created` / `user.disabled` / `user.enabled` | account administration |
| `user.roles.updated` | roles changed (`detail.before`, `detail.after`) |
| `user.password.reset` | administrator reset (FR-ID-02) |

New modules add their own `module.entity.verb` actions through `AuditService.record(...)`;
the frontend labels them in `frontend/src/lib/audit/auditLabels.ts` (unknown ones show their code).
