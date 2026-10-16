/**
 * Pure Module Registry rules (FR-PL-03, FR-ID-06), kept free of Nest/Prisma
 * so each one is unit-tested.
 */

export interface CatalogueModule {
  code: string;
  name: string;
  category: string;
  description: string | null;
  /** codes of the modules this one needs */
  dependsOn: string[];
}

/** Core modules are always on and can never be switched off. */
export function isCore(module: Pick<CatalogueModule, 'category'>): boolean {
  return module.category === 'core';
}

/** Active modules of a school = its switched-on modules + every core module. */
export function activeSet(catalogue: CatalogueModule[], switchedOn: Iterable<string>): Set<string> {
  const known = new Set(catalogue.map((m) => m.code));
  const active = new Set(catalogue.filter(isCore).map((m) => m.code));
  for (const code of switchedOn) if (known.has(code)) active.add(code);
  return active;
}

/** Dependencies of `code` that are not active (activation must be refused if any). */
export function missingDependencies(
  code: string,
  catalogue: CatalogueModule[],
  active: ReadonlySet<string>,
): string[] {
  const module = catalogue.find((m) => m.code === code);
  return (module?.dependsOn ?? []).filter((dep) => !active.has(dep));
}

/** Active modules that need `code` (deactivation must be refused if any). */
export function activeDependents(
  code: string,
  catalogue: CatalogueModule[],
  active: ReadonlySet<string>,
): string[] {
  return catalogue
    .filter((m) => active.has(m.code) && m.dependsOn.includes(code))
    .map((m) => m.code);
}

/** "student.record.view" -> "student" */
export function moduleOfPermission(permissionCode: string): string {
  return permissionCode.split('.')[0] ?? permissionCode;
}

/**
 * Permissions of an inactive module are not effective (FR-ID-06): they are
 * dropped from what a user can do, even if a role still lists them.
 */
export function effectivePermissions(permissions: string[], active: ReadonlySet<string>): string[] {
  return permissions.filter((code) => active.has(moduleOfPermission(code)));
}

/** "academic, enrollment" with module names when known. */
export function moduleNames(codes: string[], catalogue: CatalogueModule[]): string {
  return codes.map((code) => catalogue.find((m) => m.code === code)?.name ?? code).join(', ');
}
