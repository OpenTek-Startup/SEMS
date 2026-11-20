import {
  changedFields,
  cleanText,
  filterStaff,
  matchesSearch,
  nextStaffNumber,
  normalizePhone,
  normalizeStaffNumber,
  toStaffView,
  type StaffRow,
} from './staff-rules';

const row = (over: Partial<StaffRow> = {}): StaffRow => ({
  id: 's1',
  staffNumber: 'STF-0001',
  firstName: 'Brenda',
  lastName: 'Ngwa',
  email: 'b.ngwa@northfield.school',
  phone: '+237 677 12 34 56',
  position: 'Mathematics teacher',
  category: 'teaching',
  status: 'active',
  hireDate: new Date('2024-09-02T00:00:00.000Z'),
  userId: null,
  ...over,
});

describe('staff rules', () => {
  it('cleans names and staff numbers', () => {
    expect(cleanText('  Ngwa   Brenda ')).toBe('Ngwa Brenda');
    expect(normalizeStaffNumber('  stf-0007 ')).toBe('STF-0007');
    expect(normalizeStaffNumber('nf/2024/12')).toBe('NF/2024/12');
    expect(normalizeStaffNumber('a')).toBeNull();
    expect(normalizeStaffNumber('STF_01')).toBeNull();
    expect(normalizeStaffNumber('-STF1')).toBeNull();
  });

  it('generates the next staff number after the highest one', () => {
    expect(nextStaffNumber([])).toBe('STF-0001');
    expect(nextStaffNumber(['STF-0001', 'STF-0009', 'NF/2024/12', 'STF-0003'])).toBe('STF-0010');
    expect(nextStaffNumber(['STF-12345'])).toBe('STF-12346');
  });

  it('accepts phone numbers as people type them', () => {
    expect(normalizePhone(' +237  677 12 34 56 ')).toBe('+237 677 12 34 56');
    expect(normalizePhone('(677) 123-456')).toBe('(677) 123-456');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('+1 234 567 890 123 456')).toBeNull();
  });

  it('builds the view: last name first, calendar-day hire date, linked account', () => {
    const accounts = new Map([['u1', { id: 'u1', email: 'b.ngwa@northfield.school', status: 'active' }]]);
    const view = toStaffView(row({ userId: 'u1' }), accounts);
    expect(view).toMatchObject({ fullName: 'Ngwa Brenda', hireDate: '2024-09-02', account: { id: 'u1' } });
    expect(toStaffView(row({ hireDate: null }), accounts)).toMatchObject({ hireDate: null, account: null });
  });

  it('searches every word, ignoring case and accents, and filters', () => {
    const none = new Map();
    const brenda = toStaffView(row(), none);
    const eric = toStaffView(
      row({ id: 's2', staffNumber: 'STF-0002', firstName: 'Éric', lastName: 'Abena', position: 'Bursar', category: 'non_teaching', email: null, phone: null }),
      none,
    );
    const old = toStaffView(row({ id: 's3', staffNumber: 'STF-0003', firstName: 'Paul', lastName: 'Zama', status: 'inactive' }), none);

    expect(matchesSearch(brenda, 'brenda MATH')).toBe(true);
    expect(matchesSearch(brenda, 'brenda bursar')).toBe(false);
    expect(matchesSearch(eric, 'eric')).toBe(true);
    expect(matchesSearch(brenda, '0001')).toBe(true);
    expect(matchesSearch(brenda, '677 12')).toBe(true);

    const all = [old, brenda, eric];
    expect(filterStaff(all, {}).map((v) => v.lastName)).toEqual(['Abena', 'Ngwa', 'Zama']);
    expect(filterStaff(all, { status: 'active' }).map((v) => v.lastName)).toEqual(['Abena', 'Ngwa']);
    expect(filterStaff(all, { category: 'teaching', status: 'active' }).map((v) => v.lastName)).toEqual(['Ngwa']);
    expect(filterStaff(all, { search: '   ' })).toHaveLength(3);
  });

  it('lists the fields that changed', () => {
    const before = { position: 'Teacher', phone: null as string | null, hireDate: new Date('2024-09-02') };
    expect(changedFields(before, { ...before })).toEqual([]);
    expect(changedFields(before, { position: 'Head teacher', phone: '677123456', hireDate: new Date('2024-09-02') })).toEqual([
      'phone',
      'position',
    ]);
  });
});
