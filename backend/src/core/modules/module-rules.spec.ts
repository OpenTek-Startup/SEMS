import {
  activeDependents,
  activeSet,
  type CatalogueModule,
  effectivePermissions,
  isCore,
  missingDependencies,
  moduleNames,
  moduleOfPermission,
} from './module-rules';

const m = (code: string, dependsOn: string[] = [], category = 'business'): CatalogueModule => ({
  code,
  name: code[0].toUpperCase() + code.slice(1),
  category,
  description: null,
  dependsOn,
});

const CATALOGUE = [
  m('core', [], 'core'),
  m('student'),
  m('academic'),
  m('enrollment', ['student', 'academic']),
  m('assessment', ['academic', 'enrollment']),
];

describe('module rules', () => {
  it('core modules are always active; unknown codes are ignored', () => {
    expect(isCore(CATALOGUE[0])).toBe(true);
    expect([...activeSet(CATALOGUE, ['student', 'ghost'])].sort()).toEqual(['core', 'student']);
  });

  it('lists the dependencies that block an activation', () => {
    const active = activeSet(CATALOGUE, ['student']);
    expect(missingDependencies('assessment', CATALOGUE, active)).toEqual(['academic', 'enrollment']);
    expect(missingDependencies('academic', CATALOGUE, active)).toEqual([]);
  });

  it('lists the active modules that block a deactivation', () => {
    const active = activeSet(CATALOGUE, ['student', 'academic', 'enrollment']);
    expect(activeDependents('academic', CATALOGUE, active)).toEqual(['enrollment']);
    expect(activeDependents('enrollment', CATALOGUE, active)).toEqual([]);
  });

  it('keeps only permissions of active modules', () => {
    const active = activeSet(CATALOGUE, ['student']);
    expect(moduleOfPermission('student.record.view')).toBe('student');
    expect(
      effectivePermissions(['core.user.view', 'student.record.view', 'assessment.marks.enter'], active),
    ).toEqual(['core.user.view', 'student.record.view']);
  });

  it('names modules for messages', () => {
    expect(moduleNames(['academic', 'ghost'], CATALOGUE)).toBe('Academic, ghost');
  });
});
