import {
  checkEditable,
  checkHeldOn,
  checkScoring,
  nextStatus,
  sortAssessments,
  toAssessmentView,
  type AssessmentRow,
  type Lookups,
} from './assessment-rules';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const lookups: Lookups = {
  terms: new Map([
    ['t1', { id: 't1', name: 'First Term', startDate: day('2026-09-07') }],
    ['t2', { id: 't2', name: 'Second Term', startDate: day('2027-01-04') }],
  ]),
  sections: new Map([
    ['s1', { id: 's1', label: 'Form 1 A' }],
    ['s2', { id: 's2', label: 'Form 2 A' }],
    ['s10', { id: 's10', label: 'Form 10 A' }],
  ]),
  subjects: new Map([
    ['eng', { id: 'eng', code: 'ENG', name: 'English' }],
    ['math', { id: 'math', code: 'MATH', name: 'Mathematics' }],
  ]),
};

const row = (over: Partial<AssessmentRow> = {}): AssessmentRow => ({
  id: 'a1',
  academicYearId: 'y1',
  termId: 't1',
  sectionId: 's1',
  subjectId: 'math',
  name: 'Sequence 1',
  maxScore: 20,
  weight: 1,
  heldOn: day('2026-10-12'),
  status: 'open',
  submittedAt: null,
  validatedAt: null,
  lockedAt: null,
  createdAt: day('2026-10-01'),
  ...over,
});

describe('assessment rules', () => {
  it('moves through open, submitted, validated, locked', () => {
    expect(nextStatus('open', 'submit')).toBe('submitted');
    expect(nextStatus('submitted', 'validate')).toBe('validated');
    expect(nextStatus('validated', 'lock')).toBe('locked');
    expect(nextStatus('submitted', 'reopen')).toBe('open');
    expect(nextStatus('validated', 'reopen')).toBe('open');
  });

  it('refuses steps out of order, and anything once locked', () => {
    expect(nextStatus('open', 'validate')).toMatchObject({ code: 'STATUS_INVALID', status: 'open' });
    expect(nextStatus('open', 'lock')).toMatchObject({ code: 'STATUS_INVALID' });
    expect(nextStatus('submitted', 'submit')).toMatchObject({ code: 'STATUS_INVALID' });
    for (const action of ['submit', 'validate', 'reopen', 'lock'] as const) {
      expect(nextStatus('locked', action)).toMatchObject({ code: 'STATUS_INVALID', status: 'locked' });
    }
    const problem = nextStatus('open', 'lock');
    expect(typeof problem === 'object' && problem.message).toBe('This assessment is open; only a validated assessment can be locked.');
  });

  it('allows edits only while open', () => {
    expect(checkEditable('open')).toBeNull();
    expect(checkEditable('submitted')?.code).toBe('ASSESSMENT_NOT_OPEN');
    expect(checkEditable('locked')?.code).toBe('ASSESSMENT_NOT_OPEN');
  });

  it('checks the maximum score and the weight', () => {
    expect(checkScoring(20, 1)).toBeNull();
    expect(checkScoring(100, 10)).toBeNull();
    expect(checkScoring(0, 1)?.code).toBe('MAX_SCORE_INVALID');
    expect(checkScoring(101, 1)?.code).toBe('MAX_SCORE_INVALID');
    expect(checkScoring(12.5, 1)?.code).toBe('MAX_SCORE_INVALID');
    expect(checkScoring(20, 0)?.code).toBe('WEIGHT_INVALID');
    expect(checkScoring(20, 11)?.code).toBe('WEIGHT_INVALID');
  });

  it('keeps the date inside the term, both ends included', () => {
    const term = { name: 'First Term', startDate: day('2026-09-07'), endDate: day('2026-12-11') };
    expect(checkHeldOn(day('2026-09-07'), term)).toBeNull();
    expect(checkHeldOn(day('2026-12-11'), term)).toBeNull();
    expect(checkHeldOn(day('2026-12-12'), term)).toMatchObject({
      code: 'DATE_OUTSIDE_TERM',
      message: '2026-12-12 is outside First Term (2026-09-07 to 2026-12-11).',
    });
  });

  it('builds the view with names and calendar days', () => {
    expect(toAssessmentView(row({ status: 'submitted', submittedAt: day('2026-10-20') }), lookups)).toEqual({
      id: 'a1',
      yearId: 'y1',
      term: { id: 't1', name: 'First Term' },
      section: { id: 's1', label: 'Form 1 A' },
      subject: { id: 'math', code: 'MATH', name: 'Mathematics' },
      name: 'Sequence 1',
      maxScore: 20,
      weight: 1,
      heldOn: '2026-10-12',
      status: 'submitted',
      submittedAt: '2026-10-20T00:00:00.000Z',
      validatedAt: null,
      lockedAt: null,
    });
  });

  it('sorts by section, subject, term, date, then name', () => {
    const rows = [
      row({ id: 'f10', sectionId: 's10' }),
      row({ id: 'eng', subjectId: 'eng' }),
      row({ id: 'second-term', termId: 't2', heldOn: day('2027-01-20') }),
      row({ id: 'undated', heldOn: null, name: 'Homework' }),
      row({ id: 'seq2', name: 'Sequence 2', heldOn: day('2026-11-16') }),
      row({ id: 'seq1' }),
      row({ id: 'f2', sectionId: 's2' }),
    ];
    expect(sortAssessments(rows, lookups).map((r) => r.id)).toEqual([
      'eng',
      'seq1',
      'seq2',
      'undated',
      'second-term',
      'f2',
      'f10',
    ]);
  });
});
