"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useGetCatalogueQuery,
  useGetPlatformSchoolsQuery,
  useSetSchoolModuleMutation,
  type CatalogueModule,
  type PlatformSchool,
} from "@/lib/api/modulesApi";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "@/components/layout/AppHeader";

/**
 * /platform — Super Admin console: switch modules on or off per school
 * (Module Registry, FR-PL-03). The backend enforces dependencies and
 * explains any refusal; this page only shows it.
 */
export default function PlatformConsole() {
  const isSuperAdmin = useAppSelector((state) => !!state.auth.user?.isSuperAdmin);
  const schools = useGetPlatformSchoolsQuery(undefined, { skip: !isSuperAdmin });
  const catalogue = useGetCatalogueQuery(undefined, { skip: !isSuperAdmin });
  const [setModule] = useSetSchoolModuleMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-1 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-warn">
            Only the platform Super Admin can manage schools and modules.
          </p>
        </main>
      </div>
    );
  }

  const optional = (catalogue.data ?? []).filter((m) => m.category !== "core");

  async function toggle(school: PlatformSchool, module: CatalogueModule) {
    const active = !school.activeModules.includes(module.code);
    const key = `${school.id}:${module.code}`;
    setBusy(key);
    setMessage(null);
    try {
      await setModule({ schoolId: school.id, code: module.code, active }).unwrap();
      setMessage({
        kind: "ok",
        text: `${module.name} ${active ? "activated" : "deactivated"} for ${school.name}.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const loadError = schools.error ?? catalogue.error;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-semibold">Schools &amp; modules</h1>
        <p className="mt-1 text-sm text-muted">
          Switch modules on or off for each school. A module needs its dependencies first; the core is always on.
        </p>

        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`mt-4 rounded-lg p-3 text-sm ${
              message.kind === "error" ? "bg-err-bg text-err" : "bg-ok-bg text-ok"
            }`}
          >
            {message.text}
          </p>
        )}

        {loadError && (
          <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
            {apiErrorMessage(loadError)}
          </p>
        )}
        {(schools.isLoading || catalogue.isLoading) && (
          <p className="mt-6 text-sm text-muted">Loading schools…</p>
        )}

        {schools.data && catalogue.data && (
          <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">School</th>
                  {optional.map((m) => (
                    <th
                      key={m.code}
                      className="px-2 py-3 text-center font-semibold"
                      title={m.dependsOn.length > 0 ? `Needs: ${m.dependsOn.join(", ")}` : "No dependencies"}
                    >
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.data.map((school) => (
                  <tr key={school.id} className="border-t border-line first:border-t-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{school.name}</p>
                      <p className="text-xs text-muted">
                        {school.slug} · {school.type}
                        {school.status !== "active" && <span className="ml-1 text-err">· {school.status}</span>}
                      </p>
                    </td>
                    {optional.map((m) => {
                      const on = school.activeModules.includes(m.code);
                      const key = `${school.id}:${m.code}`;
                      return (
                        <td key={m.code} className="px-2 py-3 text-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${m.name} for ${school.name}`}
                            onClick={() => void toggle(school, m)}
                            disabled={busy !== null}
                            className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                              on ? "bg-brand" : "bg-line"
                            }`}
                          >
                            <span
                              className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                on ? "translate-x-5" : "translate-x-0"
                              } ${busy === key ? "animate-pulse" : ""}`}
                            />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {catalogue.data && (
          <section className="mt-6 rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-semibold text-muted">Dependencies</h2>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {optional.map((m) => (
                <li key={m.code}>
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted">
                    {" "}
                    — {m.dependsOn.length > 0 ? `needs ${m.dependsOn.join(", ")}` : "no dependencies"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
