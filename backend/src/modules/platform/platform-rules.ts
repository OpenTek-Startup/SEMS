/**
 * Pure rules for the Super Admin console, kept free of Nest/Prisma so they
 * are unit-tested.
 */
import { isValidSlug } from '../../core/tenancy/tenant-resolution';

export interface Problem {
  code: string;
  message: string;
  [key: string]: unknown;
}

/** Slugs a school may not take (besides the ones the tenancy layer reserves). */
const EXTRA_RESERVED = new Set(['yese', 'opentek', 'support', 'help', 'mail', 'static', 'assets', 'login']);

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/** "  Hillside-College " -> "hillside-college" */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The slug becomes the school's subdomain (hillside.yese.app) and its
 * X-Tenant value: lower-case letters, digits and hyphens, 3 to 40 long,
 * not starting or ending with a hyphen, not a reserved word.
 */
export function checkSlug(slug: string): Problem | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return { code: 'SLUG_INVALID', message: `The school code must be ${SLUG_MIN} to ${SLUG_MAX} characters long.` };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { code: 'SLUG_INVALID', message: 'The school code may only contain lower-case letters, digits and hyphens.' };
  }
  if (slug.startsWith('-') || slug.endsWith('-') || slug.includes('--')) {
    return { code: 'SLUG_INVALID', message: 'The school code cannot start or end with a hyphen, or contain two in a row.' };
  }
  if (!isValidSlug(slug) || EXTRA_RESERVED.has(slug)) {
    return { code: 'SLUG_RESERVED', message: `"${slug}" is reserved. Choose another school code.` };
  }
  return null;
}

/**
 * A slug proposed from the school's name, e.g.
 * "Lycée Bilingue de Buea" -> "lycee-bilingue-de-buea". The Super Admin can change it.
 */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

/** Trims and collapses inner spaces: "  Hillside   College " -> "Hillside College". */
export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** The permission codes a role receives, keeping only codes that exist in the catalogue. */
export function permissionIdsFor(
  codes: readonly string[],
  catalogue: readonly { id: string; code: string }[],
): string[] {
  const byCode = new Map(catalogue.map((p) => [p.code, p.id]));
  return [...new Set(codes)].map((code) => byCode.get(code)).filter((id): id is string => !!id);
}
