import { checkSlug, cleanText, normalizeSlug, permissionIdsFor, slugFromName } from './platform-rules';

describe('platform rules', () => {
  it('normalizes and accepts good school codes', () => {
    expect(normalizeSlug('  Hillside-College ')).toBe('hillside-college');
    expect(checkSlug('hillside')).toBeNull();
    expect(checkSlug('gbhs-buea-2')).toBeNull();
  });

  it('refuses bad school codes with a clear reason', () => {
    expect(checkSlug('ab')?.code).toBe('SLUG_INVALID');
    expect(checkSlug('a'.repeat(41))?.code).toBe('SLUG_INVALID');
    expect(checkSlug('hill side')?.code).toBe('SLUG_INVALID');
    expect(checkSlug('Hillside')?.code).toBe('SLUG_INVALID');
    expect(checkSlug('-hillside')?.code).toBe('SLUG_INVALID');
    expect(checkSlug('hill--side')?.code).toBe('SLUG_INVALID');
    expect(checkSlug('admin')?.code).toBe('SLUG_RESERVED');
    expect(checkSlug('platform')?.code).toBe('SLUG_RESERVED');
    expect(checkSlug('support')?.code).toBe('SLUG_RESERVED');
  });

  it('proposes a code from the school name', () => {
    expect(slugFromName('Lycée Bilingue de Buea')).toBe('lycee-bilingue-de-buea');
    expect(slugFromName("  G.B.H.S. Molyko's ")).toBe('g-b-h-s-molyko-s');
    expect(slugFromName('A'.repeat(60)).length).toBe(40);
  });

  it('cleans text and maps permission codes to ids', () => {
    expect(cleanText('  Hillside   College ')).toBe('Hillside College');
    const catalogue = [
      { id: 'p1', code: 'core.user.view' },
      { id: 'p2', code: 'staff.record.view' },
    ];
    expect(permissionIdsFor(['staff.record.view', 'core.user.view', 'staff.record.view', 'gone.code'], catalogue)).toEqual([
      'p2',
      'p1',
    ]);
  });
});
