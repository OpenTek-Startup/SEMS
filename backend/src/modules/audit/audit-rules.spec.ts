import { buildAuditWhere, fullName, MAX_PAGE_SIZE, pageOf } from './audit-rules';

describe('audit rules', () => {
  it('filters a category by prefix and one action exactly', () => {
    expect(buildAuditWhere({ action: 'user.' })).toEqual({ action: { startsWith: 'user.' } });
    expect(buildAuditWhere({ action: 'user.created' })).toEqual({ action: 'user.created' });
    expect(buildAuditWhere({})).toEqual({});
  });

  it('turns whole days into a [from, next day) range', () => {
    const where = buildAuditWhere({ from: '2026-10-01', to: '2026-10-15' }) as {
      createdAt: { gte: Date; lt: Date };
    };
    expect(where.createdAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.createdAt.lt.toISOString()).toBe('2026-10-16T00:00:00.000Z');

    const sameDay = buildAuditWhere({ from: '2026-10-15', to: '2026-10-15' }) as {
      createdAt: { gte: Date; lt: Date };
    };
    expect(sameDay.createdAt.lt.getTime() - sameDay.createdAt.gte.getTime()).toBe(86_400_000);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => buildAuditWhere({ from: '2026-10-15', to: '2026-10-01' })).toThrow('"from" must be before "to".');
  });

  it('keeps the person filter as given', () => {
    expect(buildAuditWhere({ actorUserId: 'u1' })).toEqual({ actorUserId: 'u1' });
  });

  it('clamps paging', () => {
    expect(pageOf()).toEqual({ page: 1, pageSize: 25, skip: 0, take: 25 });
    expect(pageOf(3, 10)).toEqual({ page: 3, pageSize: 10, skip: 20, take: 10 });
    expect(pageOf(0, 0)).toEqual({ page: 1, pageSize: 1, skip: 0, take: 1 });
    expect(pageOf(1, 5000).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('formats names', () => {
    expect(fullName({ firstName: 'M.', lastName: 'Ndzana' })).toBe('M. Ndzana');
  });
});
