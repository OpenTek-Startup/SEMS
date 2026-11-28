"use client";

import { useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateSchoolMutation,
  useGetCatalogueQuery,
  useGetPlatformSchoolsQuery,
  useSetSchoolModuleMutation,
  useSetSchoolStatusMutation,
  type CatalogueModule,
  type InstitutionType,
  type PlatformSchool,
} from "@/lib/api/modulesApi";
import { useAppSelector } from "@/store/hooks";
import OneTimePasswordNotice, { type OneTimePassword } from "@/components/ui/OneTimePasswordNotice";
import { fieldClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";

/**
 * /platform — Super Admin console: create schools (FR-PL-01), suspend or
 * reactivate them (FR-PL-02), and switch modules on or off per school
 * (Module Registry, FR-PL-03). The backend enforces every rule and
 * explains any refusal; this page only shows it.
 */
export default function PlatformConsole() {
  const isSuperAdmin = useAppSelector((state) => !!state.auth.user?.isSuperAdmin);
  const schools = useGetPlatformSchoolsQuery(undefined, { skip: !isSuperAdmin });
  const catalogue = useGetCatalogueQuery(undefined, { skip: !isSuperAdmin });
  const [setModule] = useSetSchoolModuleMutation();
  const [setStatus] = useSetSchoolStatusMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [oneTime, setOneTime] = useState<OneTimePassword | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-1 flex-col">
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

  async function toggleStatus(school: PlatformSchool) {
    const status = school.status === "suspended" ? "active" : "suspended";
    const question =
      status === "suspended"
        ? `Suspend ${school.name}? Nobody will be able to use it and everyone signed in there is signed out.`
        : `Reactivate ${school.name}?`;
    if (!window.confirm(question)) return;
    setBusy(`${school.id}:status`);
    setMessage(null);
    try {
      await setStatus({ schoolId: school.id, status }).unwrap();
      setMessage({ kind: "ok", text: `${school.name} ${status === "suspended" ? "suspended" : "reactivated"}.` });
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const loadError = schools.error ?? catalogue.error;

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Platform</p>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold">Schools &amp; modules</h1>
            <p className="mt-1 text-sm text-muted">
              Create schools and switch their modules on or off. A module needs its dependencies first; the core is
              always on.
            </p>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={() => {
                setShowForm(true);
                setOneTime(null);
              }}
              className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Add a school
            </button>
          )}
        </div>

        {oneTime && <OneTimePasswordNotice value={oneTime} onClose={() => setOneTime(null)} />}

        {showForm && (
          <CreateSchoolForm
            onCancel={() => setShowForm(false)}
            onCreated={(value, schoolName) => {
              setShowForm(false);
              setOneTime(value);
              setMessage({ kind: "ok", text: `${schoolName} created. Switch on its modules below.` });
            }}
          />
        )}

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
                  <th className="px-2 py-3 font-semibold">
                    <span className="sr-only">Status</span>
                  </th>
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
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        onClick={() => void toggleStatus(school)}
                        disabled={busy !== null}
                        className={secondaryButtonClass}
                      >
                        {school.status === "suspended" ? "Reactivate" : "Suspend"}
                      </button>
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

/** "Lycée Bilingue de Buea" -> "lycee-bilingue-de-buea" (the Super Admin can change it). */
function slugFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function CreateSchoolForm(props: {
  onCancel: () => void;
  onCreated: (value: OneTimePassword, schoolName: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [type, setType] = useState<InstitutionType>("secondary");
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createSchool, { isLoading }] = useCreateSchoolMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createSchool({
        name: name.trim(),
        slug: slug.trim(),
        type,
        adminEmail: adminEmail.trim(),
        adminFirstName: adminFirstName.trim(),
        adminLastName: adminLastName.trim(),
      }).unwrap();
      props.onCreated(
        {
          name: `${result.admin.firstName} ${result.admin.lastName} (administrator of ${result.school.name})`,
          email: result.admin.email,
          password: result.temporaryPassword,
        },
        result.school.name,
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create the school."));
    }
  }

  const ready = name.trim() && slug.trim() && adminFirstName.trim() && adminLastName.trim() && adminEmail.trim();

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-line bg-white p-5" noValidate>
      <h2 className="font-semibold">Add a school</h2>
      <p className="mt-1 text-sm text-muted">
        The school starts with its four base roles and one administrator. Only the core is on until you switch
        modules on.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="schoolName" className={labelClass}>
            Name
          </label>
          <input
            id="schoolName"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugFromName(e.target.value));
            }}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="schoolType" className={labelClass}>
            Type
          </label>
          <select
            id="schoolType"
            value={type}
            onChange={(e) => setType(e.target.value as InstitutionType)}
            className={fieldClass}
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="university">University</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="schoolSlug" className={labelClass}>
            School code
          </label>
          <input
            id="schoolSlug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setSlugEdited(true);
            }}
            aria-describedby="schoolSlugHelp"
            className={`${fieldClass} font-mono`}
          />
          <p id="schoolSlugHelp" className="mt-1 text-xs text-muted">
            Its web address: <span className="font-mono">{slug || "code"}.yese.app</span>. Lower-case letters, digits
            and hyphens, 3 to 40 characters. It cannot be changed later.
          </p>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className={labelClass}>First administrator</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="adminFirstName" className="text-xs text-muted">
              First name
            </label>
            <input
              id="adminFirstName"
              value={adminFirstName}
              onChange={(e) => setAdminFirstName(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="adminLastName" className="text-xs text-muted">
              Last name
            </label>
            <input
              id="adminLastName"
              value={adminLastName}
              onChange={(e) => setAdminLastName(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="adminEmail" className="text-xs text-muted">
              Email
            </label>
            <input
              id="adminEmail"
              type="email"
              autoComplete="off"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={!ready || isLoading} className={`${primaryButtonClass} sm:w-auto sm:px-6`}>
          {isLoading ? "Creating…" : "Create school"}
        </button>
        <button type="button" onClick={props.onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
