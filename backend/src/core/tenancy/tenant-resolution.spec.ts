import { isValidSlug, resolveTenantSlug, slugFromHost } from './tenant-resolution';

describe('tenant resolution', () => {
  it('reads the school from a subdomain', () => {
    expect(slugFromHost('northfield.yese.app')).toBe('northfield');
    expect(slugFromHost('Northfield.yese.app:443')).toBe('northfield');
    expect(slugFromHost('sunrise.localhost:3001')).toBe('sunrise');
  });

  it('ignores hosts without a school subdomain', () => {
    expect(slugFromHost('localhost:3001')).toBeUndefined();
    expect(slugFromHost('yese.app')).toBeUndefined();
    expect(slugFromHost('127.0.0.1:3001')).toBeUndefined();
    expect(slugFromHost('www.yese.app')).toBeUndefined();
    expect(slugFromHost(undefined)).toBeUndefined();
  });

  it('prefers the X-Tenant header when allowed (development)', () => {
    expect(resolveTenantSlug({ headerValue: ' Sunrise ', host: 'northfield.yese.app', allowHeader: true })).toBe('sunrise');
  });

  it('ignores the X-Tenant header in production', () => {
    expect(resolveTenantSlug({ headerValue: 'sunrise', host: 'northfield.yese.app', allowHeader: false })).toBe('northfield');
    expect(resolveTenantSlug({ headerValue: 'sunrise', host: 'localhost', allowHeader: false })).toBeUndefined();
  });

  it('validates slugs', () => {
    expect(isValidSlug('northfield')).toBe(true);
    expect(isValidSlug('my-school-2')).toBe(true);
    expect(isValidSlug('-bad')).toBe(false);
    expect(isValidSlug('bad slug')).toBe(false);
    expect(isValidSlug('api')).toBe(false);
  });
});
