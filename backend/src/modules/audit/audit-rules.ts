/**
 * Pure rules for reading the audit log, kept free of Nest/Prisma so they are unit-tested.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Filters accepted by GET /api/audit (all optional). */
export interface AuditFilter {
  /** "auth." or "user." (a category, ends with a dot) or one exact action. */
  action?: string;
  actorUserId?: string;
  /** "2026-10-15" (whole day) or a full ISO date-time. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Start of a date-only value, or the instant given. */
function startOf(value: string): Date {
  return DATE_ONLY.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}

/** End (exclusive) of a date-only value: the next day at 00:00; otherwise just after the instant. */
function endOf(value: string): Date {
  if (DATE_ONLY.test(value)) {
    const d = new Date(`${value}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  return new Date(new Date(value).getTime() + 1);
}

export class AuditFilterError extends Error {}

/**
 * Turns the filter into a Prisma `where` (school scoping is added by the
 * school-scoped client, never here).
 */
export function buildAuditWhere(filter: AuditFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filter.action) {
    where.action = filter.action.endsWith('.') ? { startsWith: filter.action } : filter.action;
  }
  if (filter.actorUserId) where.actorUserId = filter.actorUserId;

  const createdAt: Record<string, Date> = {};
  if (filter.from) createdAt.gte = startOf(filter.from);
  if (filter.to) createdAt.lt = endOf(filter.to);
  if (createdAt.gte && createdAt.lt && createdAt.gte >= createdAt.lt) {
    throw new AuditFilterError('"from" must be before "to".');
  }
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

  return where;
}

/** Page number and size, clamped to sane limits; returns Prisma skip/take too. */
export function pageOf(page?: number, pageSize?: number) {
  const size = Math.min(Math.max(Math.trunc(pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const number = Math.max(Math.trunc(page ?? 1), 1);
  return { page: number, pageSize: size, skip: (number - 1) * size, take: size };
}

/** "Ndzana" + "M." -> "M. Ndzana" */
export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
