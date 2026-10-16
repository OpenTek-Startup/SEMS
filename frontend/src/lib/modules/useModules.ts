import { useGetSchoolModulesQuery } from "@/lib/api/modulesApi";
import { useAppSelector } from "@/store/hooks";

/**
 * Active module codes of the signed-in user's school (empty for the Super
 * Admin, who has no school). Use it to hide menus of inactive modules —
 * the backend refuses their routes anyway (403 MODULE_INACTIVE).
 */
export function useActiveModules(): { codes: Set<string>; isLoading: boolean } {
  const user = useAppSelector((state) => state.auth.user);
  const hasSchool = Boolean(user?.school);
  const query = useGetSchoolModulesQuery(undefined, { skip: !hasSchool });
  const codes = new Set<string>((query.data ?? []).filter((m) => m.active).map((m) => m.code));
  return { codes, isLoading: hasSchool && query.isLoading };
}

/** True when the module is active for the current school. */
export function useModuleActive(code: string): boolean {
  return useActiveModules().codes.has(code);
}
