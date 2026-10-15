"use client";

import Link from "next/link";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "@/components/layout/AppHeader";

/** Groups "student.record.view" style codes by their module (first segment). */
function byModule(permissions: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const code of permissions) {
    const moduleCode = code.split(".")[0] ?? code;
    groups.set(moduleCode, [...(groups.get(moduleCode) ?? []), code]);
  }
  return [...groups.entries()];
}

/**
 * First signed-in page: proves the whole chain works
 * (session, school, roles, permissions). The real dashboard (mockup 04)
 * replaces the body once the business modules exist.
 */
export default function Dashboard() {
  const user = useAppSelector((state) => state.auth.user);
  if (!user) return null;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-semibold">Welcome, {user.firstName}</h1>
        <p className="mt-1 text-sm text-muted">
          You are signed in{user.school ? ` to ${user.school.name}` : " to the YESE platform"}.
          You will be signed out after 15 minutes without activity.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-semibold text-muted">Account</h2>
            <p className="mt-2 font-semibold">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-sm text-muted">{user.email}</p>
            <Link href="/change-password" className="mt-3 inline-block text-sm text-brand hover:underline">
              Change password
            </Link>
          </section>

          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-semibold text-muted">School</h2>
            <p className="mt-2 font-semibold">{user.school?.name ?? "Platform (no school)"}</p>
            {user.school && <p className="text-sm text-muted">{user.school.slug}</p>}
            {user.isSuperAdmin && (
              <p className="mt-2 inline-block rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">
                Super Admin
              </p>
            )}
          </section>

          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-semibold text-muted">Roles</h2>
            <ul className="mt-2 space-y-1">
              {user.roles.length === 0 && <li className="text-sm text-muted">No role yet</li>}
              {user.roles.map((role) => (
                <li key={role.id} className="text-sm">
                  <span className="font-semibold">{role.name}</span>
                  {role.archetype && <span className="text-muted"> · {role.archetype}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-4 rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-semibold text-muted">
            What you can do ({user.permissions.length} permissions)
          </h2>
          {user.permissions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No permissions yet.</p>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {byModule(user.permissions).map(([moduleCode, codes]) => (
                <div key={moduleCode}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {moduleCode}
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {codes.map((code) => (
                      <li key={code}>{code}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
