import { byName, generateTemporaryPassword, toUserListItem, uniqueIds } from './user-rules';
import { passwordProblems } from '../../core/auth/auth-rules';

describe('user rules', () => {
  it('generates readable one-time passwords that pass the password policy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
      expect(pw).not.toMatch(/[01OlI]/);
      expect(passwordProblems(pw)).toEqual([]);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });

  it('de-duplicates role ids', () => {
    expect(uniqueIds(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('shapes a user for the list without secrets', () => {
    const item = toUserListItem({
      id: 'u1',
      email: 'teacher@northfield.school',
      firstName: 'R.',
      lastName: 'Fon',
      status: 'active',
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      roles: [
        { role: { id: 'r2', name: 'Staff / Teacher', archetype: 'staff' } },
        { role: { id: 'r1', name: 'Exam Officer', archetype: null } },
      ],
      passwordHash: 'secret',
    } as Parameters<typeof toUserListItem>[0]);
    expect(item.roles.map((r) => r.name)).toEqual(['Exam Officer', 'Staff / Teacher']);
    expect(item).not.toHaveProperty('passwordHash');
  });

  it('sorts users by last name, then first name', () => {
    const users = [
      { firstName: 'b', lastName: 'Ndzana' },
      { firstName: 'A', lastName: 'fon' },
      { firstName: 'a', lastName: 'Ndzana' },
    ].sort(byName);
    expect(users.map((u) => `${u.lastName} ${u.firstName}`)).toEqual(['fon A', 'Ndzana a', 'Ndzana b']);
  });
});
