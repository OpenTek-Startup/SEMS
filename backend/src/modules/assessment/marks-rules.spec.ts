import {
  buildSheet,
  checkComplete,
  diffMarks,
  summarize,
  checkMarksWritable,
  checkOverrideReason,
  formatMark,
  isProblem,
  parseMark,
  unmarked,
  type MarkValue,
} from './marks-rules';

describe('marks rules', () => {
  it('reads scores with a dot or a comma, and ABS', () => {
    expect(parseMark('12.5', 20)).toEqual({ score: 12.5, absent: false });
    expect(parseMark(' 12,5 ', 20)).toEqual({ score: 12.5, absent: false });
    expect(parseMark('0', 20)).toEqual({ score: 0, absent: false });
    expect(parseMark('20', 20)).toEqual({ score: 20, absent: false });
    expect(parseMark(14.25, 20)).toEqual({ score: 14.25, absent: false });
    expect(parseMark('ABS', 20)).toEqual({ score: null, absent: true });
    expect(parseMark('absent', 20)).toEqual({ score: null, absent: true });
    expect(parseMark('', 20)).toEqual({ score: null, absent: false });
    expect(parseMark(null, 20)).toEqual({ score: null, absent: false });
  });

  it('refuses text, negative numbers, too high and too precise', () => {
    expect(parseMark('twelve', 20)).toMatchObject({ code: 'MARK_INVALID' });
    expect(parseMark('-1', 20)).toMatchObject({ code: 'MARK_INVALID' });
    expect(parseMark('12.5.1', 20)).toMatchObject({ code: 'MARK_INVALID' });
    expect(parseMark('21', 20)).toMatchObject({ code: 'MARK_OUT_OF_RANGE', maxScore: 20 });
    expect(parseMark(-0.5, 20)).toMatchObject({ code: 'MARK_OUT_OF_RANGE' });
    expect(parseMark('35', 40)).toEqual({ score: 35, absent: false });
    expect(parseMark('12.333', 20)).toMatchObject({ code: 'MARK_PRECISION' });
    expect(parseMark(Number.NaN, 20)).toMatchObject({ code: 'MARK_INVALID' });
    expect(isProblem(parseMark('x', 20))).toBe(true);
    expect(isProblem(parseMark('1', 20))).toBe(false);
  });

  it('finds students without a mark and blocks submitting until all are marked', () => {
    const marks = new Map<string, MarkValue>([
      ['s1', { score: 12, absent: false }],
      ['s2', { score: null, absent: true }],
      ['s3', { score: null, absent: false }],
    ]);
    expect(unmarked(['s1', 's2', 's3', 's4'], marks)).toEqual(['s3', 's4']);
    expect(checkComplete(['s1', 's2', 's3', 's4'], marks)).toMatchObject({
      code: 'MARKS_INCOMPLETE',
      message: '2 students have no mark yet. Enter a mark or ABS before submitting.',
      missing: ['s3', 's4'],
    });
    expect(checkComplete(['s1', 's3'], marks)?.message).toBe('1 student has no mark yet. Enter a mark or ABS before submitting.');
    expect(checkComplete(['s1', 's2'], marks)).toBeNull();
    expect(checkComplete([], marks)).toBeNull();
  });

  it('lets marks change while open, not while waiting, and once locked only by override', () => {
    expect(checkMarksWritable('open', false)).toBeNull();
    expect(checkMarksWritable('submitted', false)?.code).toBe('ASSESSMENT_NOT_OPEN');
    expect(checkMarksWritable('validated', true)?.code).toBe('ASSESSMENT_NOT_OPEN');
    expect(checkMarksWritable('locked', false)?.code).toBe('MARKS_LOCKED');
    expect(checkMarksWritable('locked', true)).toBeNull();
  });

  it('needs a real reason for an override', () => {
    expect(checkOverrideReason(undefined)?.code).toBe('OVERRIDE_REASON_REQUIRED');
    expect(checkOverrideReason('   typo   ')?.code).toBe('OVERRIDE_REASON_REQUIRED');
    expect(checkOverrideReason('Copied the wrong script')).toBeNull();
  });

  it('shows marks back as typed', () => {
    expect(formatMark({ score: 12.5, absent: false })).toBe('12.5');
    expect(formatMark({ score: null, absent: true })).toBe('ABS');
    expect(formatMark({ score: null, absent: false })).toBe('');
    expect(formatMark(undefined)).toBe('');
  });
});

describe('mark sheet rules', () => {
  const ada = { studentId: 'ada', matricule: 'STU-0001', fullName: 'Abena Ada', gender: 'female' };
  const bih = { studentId: 'bih', matricule: 'STU-0002', fullName: 'Bih Clarisse', gender: 'female' };
  const che = { studentId: 'che', matricule: 'STU-0003', fullName: 'Che Daniel', gender: 'male' };
  const eto = { studentId: 'eto', matricule: 'STU-0004', fullName: 'Eto Samuel', gender: 'male' };

  it('lists the section, then students who left with a mark', () => {
    const lines = buildSheet(
      [ada, bih],
      [
        { studentId: 'ada', score: 14, absent: false },
        { studentId: 'che', score: 9.5, absent: false },
      ],
      [eto, che],
    );
    expect(lines.map((l) => [l.fullName, l.score, l.absent, l.inSection])).toEqual([
      ['Abena Ada', 14, false, true],
      ['Bih Clarisse', null, false, true],
      ['Che Daniel', 9.5, false, false],
    ]);
  });

  it('summarizes a sheet on the assessment scale', () => {
    const lines = buildSheet(
      [ada, bih, che, eto],
      [
        { studentId: 'ada', score: 14, absent: false },
        { studentId: 'bih', score: 9.5, absent: false },
        { studentId: 'che', score: null, absent: true },
      ],
      [],
    );
    expect(summarize(lines, 20)).toEqual({
      students: 4,
      marked: 2,
      absent: 1,
      missing: 1,
      average: 11.75,
      highest: 14,
      lowest: 9.5,
      passed: 1,
    });
    expect(summarize([], 20)).toMatchObject({ students: 0, average: null, highest: null });
  });

  it('keeps only real changes', () => {
    const stored = [
      { studentId: 'ada', score: 14, absent: false },
      { studentId: 'bih', score: null, absent: true },
    ];
    const incoming = new Map<string, MarkValue>([
      ['ada', { score: 14, absent: false }],
      ['bih', { score: 11, absent: false }],
      ['che', { score: null, absent: false }],
      ['eto', { score: null, absent: true }],
    ]);
    expect(diffMarks(stored, incoming)).toEqual([
      { studentId: 'bih', before: { score: null, absent: true }, after: { score: 11, absent: false } },
      { studentId: 'eto', before: null, after: { score: null, absent: true } },
    ]);
    expect(diffMarks(stored, new Map([['ada', { score: null, absent: false }]]))).toEqual([
      { studentId: 'ada', before: { score: 14, absent: false }, after: { score: null, absent: false } },
    ]);
  });
});
