/**
 * Pure rules that make a Prisma query tenant-safe (SRS NFR-SEC-01).
 * Kept free of Nest/Prisma imports so every rule is unit-tested.
 *
 *  - Tenant-owned models: reads/updates/deletes get `tenantId` added to
 *    `where`; creates get `tenantId` stamped on `data`.
 *  - Asking for a different tenantId than the current school -> error.
 *  - Using a tenant-owned model with no school in context -> error.
 *  - The Tenant model itself is reduced to "the current school only".
 *  - Global catalogues (Module, Permission) pass through unchanged.
 *
 * New tenant-owned models MUST be added to TENANT_OWNED_MODELS.
 */

export const TENANT_OWNED_MODELS = new Set<string>([
  'User',
  'Role',
  'UserRole',
  'RolePermission',
  'AuditLog',
]);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

type Args = Record<string, any> | undefined;

function scopeWhere(where: Record<string, any> | undefined, key: string, tenantId: string) {
  if (where && where[key] !== undefined && where[key] !== tenantId) {
    throw new TenantScopeError(`Query tried to reach another school (${key} mismatch)`);
  }
  return { ...(where ?? {}), [key]: tenantId };
}

function stampData(data: Record<string, any>, tenantId: string) {
  if (data.tenant !== undefined) {
    throw new TenantScopeError('Use the tenantId field, not the tenant relation, in tenant-scoped writes');
  }
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new TenantScopeError('Tried to create a record for another school');
  }
  return { ...data, tenantId };
}

export function scopeArgs(
  model: string | undefined,
  operation: string,
  args: Args,
  tenantId: string | undefined,
): Args {
  if (!model) return args;

  // The school itself: only the current one is visible; no create/delete here.
  if (model === 'Tenant') {
    if (!tenantId) throw new TenantScopeError('No school in this request context');
    if (WHERE_OPS.has(operation) && !operation.startsWith('delete')) {
      return { ...(args ?? {}), where: scopeWhere(args?.where, 'id', tenantId) };
    }
    throw new TenantScopeError(`Operation ${operation} on Tenant is not allowed in the school-scoped client`);
  }

  if (!TENANT_OWNED_MODELS.has(model)) return args; // global catalogue

  if (!tenantId) {
    throw new TenantScopeError(`No school in this request context (model ${model})`);
  }

  if (WHERE_OPS.has(operation)) {
    return { ...(args ?? {}), where: scopeWhere(args?.where, 'tenantId', tenantId) };
  }

  if (CREATE_OPS.has(operation)) {
    const data = args?.data;
    return {
      ...args,
      data: Array.isArray(data)
        ? data.map((d: Record<string, any>) => stampData(d, tenantId))
        : stampData(data ?? {}, tenantId),
    };
  }

  if (operation === 'upsert') {
    return {
      ...args,
      where: scopeWhere(args?.where, 'tenantId', tenantId),
      create: stampData(args?.create ?? {}, tenantId),
      update: args?.update,
    };
  }

  // Anything new or unexpected is refused rather than silently unscoped.
  throw new TenantScopeError(`Operation ${operation} on ${model} is not supported by the school-scoped client`);
}
