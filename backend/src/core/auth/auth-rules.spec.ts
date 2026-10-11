import {
  bearerToken,
  hashToken,
  isIdle,
  newRefreshToken,
  normalizeEmail,
  parseDurationSeconds,
  passwordProblems,
  readCookie,
  toAuthUserView,
} from './auth-rules';

describe('auth rules', () => {
  it('parses token lifetimes', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('900')).toBe(900);
    expect(parseDurationSeconds('1h')).toBe(3600);
    expect(parseDurationSeconds('1d')).toBe(86400);
    expect(() => parseDurationSeconds('15 minutes')).toThrow();
    expect(() => parseDurationSeconds('0m')).toThrow();
  });

  it('normalizes emails', () => {
    expect(normalizeEmail('  Admin@Northfield.School ')).toBe('admin@northfield.school');
  });

  it('creates random refresh tokens and stores only a stable hash', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads the bearer token', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken('Bearer')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });

  it('reads one cookie from the Cookie header', () => {
    expect(readCookie('a=1; yese_rt=tok%2Den; b=2', 'yese_rt')).toBe('tok-en');
    expect(readCookie('yese_rtx=1; b=2', 'yese_rt')).toBeUndefined();
    expect(readCookie(undefined, 'yese_rt')).toBeUndefined();
  });

  it('detects idle sessions', () => {
    const now = new Date('2026-10-11T10:30:00Z');
    expect(isIdle(new Date('2026-10-11T10:16:00Z'), now, 15)).toBe(false);
    expect(isIdle(new Date('2026-10-11T10:14:00Z'), now, 15)).toBe(true);
  });

  it('applies the password policy', () => {
    expect(passwordProblems('Northfield2026')).toEqual([]);
    expect(passwordProblems('short1')).toContain('Use at least 8 characters.');
    expect(passwordProblems('onlyletters')).toContain('Include at least one number.');
    expect(passwordProblems('1234567890')).toContain('Include at least one letter.');
    expect(passwordProblems('Same12345', { currentPassword: 'Same12345' })).toContain(
      'Choose a password different from the current one.',
    );
    expect(passwordProblems('admin1@x.school', { email: 'Admin1@X.school' })).toContain(
      'Do not use your email address as your password.',
    );
  });

  it('flattens roles into a sorted, unique permission list', () => {
    const view = toAuthUserView({
      id: 'u1',
      email: 'admin@northfield.school',
      firstName: 'M.',
      lastName: 'Ndzana',
      isSuperAdmin: false,
      mustChangePassword: true,
      tenant: { id: 't1', slug: 'northfield', name: 'Northfield Bilingual College' },
      roles: [
        {
          role: {
            id: 'r2',
            name: 'Exam Officer',
            archetype: null,
            permissions: [{ permission: { code: 'results.publish' } }, { permission: { code: 'student.record.view' } }],
          },
        },
        {
          role: {
            id: 'r1',
            name: 'Administrator',
            archetype: 'admin',
            permissions: [{ permission: { code: 'student.record.view' } }, { permission: { code: 'core.user.view' } }],
          },
        },
      ],
    });

    expect(view.school).toEqual({ id: 't1', slug: 'northfield', name: 'Northfield Bilingual College' });
    expect(view.roles.map((r) => r.name)).toEqual(['Administrator', 'Exam Officer']);
    expect(view.permissions).toEqual(['core.user.view', 'results.publish', 'student.record.view']);
    expect(view).not.toHaveProperty('passwordHash');
  });
});
