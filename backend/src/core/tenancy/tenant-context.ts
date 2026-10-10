import { AsyncLocalStorage } from 'node:async_hooks';

/** The school (tenant) a request belongs to. */
export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  type: 'primary' | 'secondary' | 'university';
  status: 'active' | 'suspended';
}

export interface TenantContext {
  tenant: TenantInfo;
}

/**
 * Holds the current school for the whole lifetime of a request, including
 * every async call it makes, without passing tenantId around by hand.
 * Set by TenantMiddleware; read by TenantPrismaService and controllers.
 */
const storage = new AsyncLocalStorage<TenantContext>();

/** Run `fn` with `tenant` as the current school. */
export function runWithTenant<T>(tenant: TenantInfo, fn: () => T): T {
  return storage.run({ tenant }, fn);
}

/** Current school, or undefined outside a school-scoped request. */
export function currentTenant(): TenantInfo | undefined {
  return storage.getStore()?.tenant;
}

/** Current school id, or undefined. */
export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenant.id;
}
