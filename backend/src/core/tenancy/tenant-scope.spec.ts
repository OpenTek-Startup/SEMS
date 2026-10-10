import { scopeArgs, TenantScopeError } from './tenant-scope';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('scopeArgs (tenant isolation rules)', () => {
  it('adds tenantId to reads on tenant-owned models', () => {
    expect(scopeArgs('Role', 'findMany', { where: { name: 'Teacher' } }, A)).toEqual({
      where: { name: 'Teacher', tenantId: A },
    });
    expect(scopeArgs('User', 'count', undefined, A)).toEqual({ where: { tenantId: A } });
  });

  it('adds tenantId to updates and deletes', () => {
    expect(scopeArgs('Role', 'update', { where: { id: 'r1' }, data: { name: 'X' } }, A)).toEqual({
      where: { id: 'r1', tenantId: A },
      data: { name: 'X' },
    });
    expect(scopeArgs('UserRole', 'deleteMany', { where: { roleId: 'r1' } }, A)).toEqual({
      where: { roleId: 'r1', tenantId: A },
    });
  });

  it('stamps tenantId on creates, including createMany', () => {
    expect(scopeArgs('Role', 'create', { data: { name: 'HOD' } }, A)).toEqual({
      data: { name: 'HOD', tenantId: A },
    });
    expect(
      scopeArgs('RolePermission', 'createMany', { data: [{ roleId: 'r', permissionId: 'p' }] }, A),
    ).toEqual({ data: [{ roleId: 'r', permissionId: 'p', tenantId: A }] });
  });

  it('refuses to read or write another school', () => {
    expect(() => scopeArgs('Role', 'findMany', { where: { tenantId: B } }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Role', 'create', { data: { name: 'X', tenantId: B } }, A)).toThrow(TenantScopeError);
  });

  it('refuses tenant-owned queries when no school is in context', () => {
    expect(() => scopeArgs('User', 'findMany', {}, undefined)).toThrow(/No school/);
  });

  it('limits the Tenant model to the current school and blocks create/delete', () => {
    expect(scopeArgs('Tenant', 'findFirst', {}, A)).toEqual({ where: { id: A } });
    expect(() => scopeArgs('Tenant', 'findUnique', { where: { id: B } }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Tenant', 'create', { data: {} }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Tenant', 'delete', { where: { id: A } }, A)).toThrow(TenantScopeError);
  });

  it('leaves global catalogues untouched', () => {
    const args = { where: { code: 'core' } };
    expect(scopeArgs('Module', 'findMany', args, A)).toBe(args);
    expect(scopeArgs('Permission', 'findMany', args, undefined)).toBe(args);
  });

  it('scopes upserts on both where and create', () => {
    expect(
      scopeArgs('Role', 'upsert', { where: { id: 'r1' }, create: { name: 'X' }, update: { name: 'Y' } }, A),
    ).toEqual({ where: { id: 'r1', tenantId: A }, create: { name: 'X', tenantId: A }, update: { name: 'Y' } });
  });

  it('rejects the tenant relation in writes (tenantId field only)', () => {
    expect(() =>
      scopeArgs('Role', 'create', { data: { name: 'X', tenant: { connect: { id: A } } } }, A),
    ).toThrow(TenantScopeError);
  });
});
