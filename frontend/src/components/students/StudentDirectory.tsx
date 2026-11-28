"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateStudentMutation,
  useGetStudentQuery,
  useGetStudentsQuery,
  useSetStudentStatusMutation,
  useUpdateStudentMutation,
  type Gender,
  type Student,
  type StudentStatus,
} from "@/lib/api/studentsApi";
import { useGetStudentResultsQuery } from "@/lib/api/resultsApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";
import { fieldClass, labelClass, secondaryButtonClass } from "@/components/ui/styles";

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The value of `value`, settled for `ms` (search as you type without a request per key). */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type Panel = { kind: "create" } | { kind: "edit"; student: Student } | { kind: "view"; id: string } | null;

/** /students — student records of the school (module "student", needs student.record.view). */
export default function StudentDirectory() {
  const me = useAppSelector((state) => state.auth.user);
  const canView = useCan(PERMISSIONS.studentView);
  const canEdit = useCan(PERMISSIONS.studentEdit);
  const modules = useActiveModules();
  const moduleOn = modules.codes.has("student");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StudentStatus | "">("active");
  const debouncedSearch = useDebounced(search);
  const students = useGetStudentsQuery(
    { search: debouncedSearch, status: status || undefined },
    { skip: !canView || !moduleOn },
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [setStudentStatus] = useSetStudentStatusMutation();

  if (modules.isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (!canView || !moduleOn) {
    return (
      <div className="flex flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-warn">
            {!moduleOn
              ? "The Students module is not active for this school."
              : "You do not have permission to see the students of this school."}
          </p>
        </main>
      </div>
    );
  }

  async function toggleStatus(student: Student) {
    const next: StudentStatus = student.status === "active" ? "inactive" : "active";
    const question =
      next === "inactive"
        ? `Mark ${student.fullName} as having left the school? The record is kept.`
        : `Mark ${student.fullName} as active again?`;
    if (!window.confirm(question)) return;
    setActionError(null);
    try {
      await setStudentStatus({ id: student.id, status: next }).unwrap();
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  const rows = students.data ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">People</p>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold">Students &amp; guardians</h1>
            <p className="mt-1 text-sm text-muted">
              Students of {me?.school?.name ?? "this school"}. Put them in classes on the Classes page.
            </p>
          </div>
          {canEdit && panel?.kind !== "create" && (
            <button
              type="button"
              onClick={() => setPanel({ kind: "create" })}
              className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Add a student
            </button>
          )}
        </div>

        {(panel?.kind === "create" || panel?.kind === "edit") && (
          <StudentForm
            key={panel.kind === "edit" ? panel.student.id : "new"}
            student={panel.kind === "edit" ? panel.student : null}
            onDone={() => setPanel(null)}
          />
        )}
        {panel?.kind === "view" && <StudentCard id={panel.id} onClose={() => setPanel(null)} />}

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="studentSearch" className={labelClass}>
              Search
            </label>
            <input
              id="studentSearch"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, matricule, guardian…"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="studentStatus" className={labelClass}>
              Status
            </label>
            <select
              id="studentStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value as StudentStatus | "")}
              className={fieldClass}
            >
              <option value="active">Active</option>
              <option value="inactive">Left the school</option>
              <option value="">All</option>
            </select>
          </div>
        </div>

        {actionError && (
          <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
            {actionError}
          </p>
        )}

        <section className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          {students.isLoading && <p className="p-5 text-sm text-muted">Loading students…</p>}
          {students.error && (
            <p role="alert" className="p-5 text-sm text-err">
              {apiErrorMessage(students.error)}
            </p>
          )}
          {students.data && rows.length === 0 && (
            <p className="p-5 text-sm text-muted">
              {search || status !== "active" ? "No student matches these filters." : "No student recorded yet."}
            </p>
          )}
          {rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Matricule</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Born</th>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 font-semibold">Guardian</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-t border-line align-top first:border-t-0">
                    <td className="px-4 py-3 font-mono text-xs">{s.matricule}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="text-left font-semibold hover:underline" onClick={() => setPanel({ kind: "view", id: s.id })}>
                        {s.fullName}
                      </button>
                      <p className="text-xs text-muted">
                        {s.gender === "female" ? "Girl" : "Boy"}
                        {s.status === "inactive" && <span className="ml-1 text-err">· left the school</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatDay(s.dateOfBirth)}
                      {s.placeOfBirth && <span> · {s.placeOfBirth}</span>}
                    </td>
                    <td className="px-4 py-3">{s.current ? s.current.label : <span className="text-xs text-muted">No class</span>}</td>
                    <td className="px-4 py-3 text-xs">
                      {s.guardian ? (
                        <>
                          <p>
                            {s.guardian.name ?? "—"}
                            {s.guardian.relationship && <span className="text-muted"> ({s.guardian.relationship})</span>}
                          </p>
                          <p className="text-muted">{s.guardian.phone}</p>
                        </>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => setPanel({ kind: "edit", student: s })} className={secondaryButtonClass}>
                            Edit
                          </button>
                          <button type="button" onClick={() => void toggleStatus(s)} className={secondaryButtonClass}>
                            {s.status === "active" ? "Has left" : "Reactivate"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {rows.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {rows.length} student{rows.length === 1 ? "" : "s"}
          </p>
        )}
      </main>
    </div>
  );
}

/** One student with their class history. */
function StudentCard({ id, onClose }: { id: string; onClose: () => void }) {
  const student = useGetStudentQuery(id);
  const s = student.data;
  return (
    <section aria-label="Student" className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="rounded-xl border border-line bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-semibold text-white" aria-hidden="true">
              {s ? `${s.lastName[0] ?? ""}${s.firstName[0] ?? ""}`.toUpperCase() : "…"}
            </div>
            <div>
              <h2 className="text-lg leading-tight font-semibold">{s ? s.fullName : "Loading…"}</h2>
              {s && (
                <p className="mt-0.5 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${s.status === "active" ? "bg-ok-bg text-ok" : "bg-ground text-muted"}`}>
                    {s.status === "active" ? "Active" : "Left the school"}
                  </span>
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-lg border border-line text-muted hover:bg-ground">
            ×
          </button>
        </div>
        {student.error && (
          <p role="alert" className="mt-3 text-sm text-err">
            {apiErrorMessage(student.error)}
          </p>
        )}
        {s && (
          <dl className="mt-4 space-y-3 text-sm">
            <RecordLine label="Matricule" value={<span className="font-mono">{s.matricule}</span>} />
            <RecordLine label="Class this year" value={s.current?.label ?? "No class"} />
            <RecordLine
              label="Born"
              value={`${formatDay(s.dateOfBirth)}${s.placeOfBirth ? `, ${s.placeOfBirth}` : ""}`}
            />
            <RecordLine label="Gender" value={s.gender === "female" ? "Female" : "Male"} />
            <RecordLine
              label="Guardian"
              value={
                s.guardian
                  ? [s.guardian.name, s.guardian.relationship && `(${s.guardian.relationship})`, s.guardian.phone && `· ${s.guardian.phone}`]
                      .filter(Boolean)
                      .join(" ")
                  : "None"
              }
            />
            <div>
              <dt className="text-[13px] text-muted">Classes</dt>
              <dd className="mt-0.5">
                {s.enrollments.length === 0 ? (
                  <span className="text-muted">Never enrolled in a class.</span>
                ) : (
                  <ul className="space-y-1">
                    {s.enrollments.map((e) => (
                      <li key={e.id}>
                        <strong>{e.year.name}</strong> · {e.section.label}
                        <span className="block text-xs text-muted">
                          from {formatDay(e.enrolledOn)}
                          {e.leftOn && ` to ${formatDay(e.leftOn)}`}
                          {e.status !== "active" && ` (${e.status}${e.reason ? `: ${e.reason}` : ""})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        )}
      </div>
      <div className="min-w-0">{s && <StudentResults studentId={s.id} />}</div>
    </section>
  );
}

function RecordLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

const avg = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

/**
 * The student's results this year, for those who may see results (results.compute,
 * module "results"): each term's average, rank and subject averages, then the year.
 */
function StudentResults({ studentId }: { studentId: string }) {
  const canSee = useCan(PERMISSIONS.resultsCompute);
  const modules = useActiveModules();
  const on = canSee && modules.codes.has("results");
  const results = useGetStudentResultsQuery(studentId, { skip: !on });
  if (!on) return null;
  const r = results.data;
  const decision = r?.annual?.decision;
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          Results{r ? ` ${r.year.name}${r.section ? ` · ${r.section.label}` : ""}` : ""}
        </h3>
        {decision && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${decision === "promoted" ? "bg-ok-bg text-ok" : "bg-err-bg text-err"}`}>
            {decision === "promoted" ? "Promoted" : "Repeats the class"}
          </span>
        )}
      </div>
      {results.isLoading && <p className="mt-1 text-sm text-muted">Loading…</p>}
      {results.error && (
        <p role="alert" className="mt-1 text-sm text-err">
          {apiErrorMessage(results.error)}
        </p>
      )}
      {r && !r.section && <p className="mt-1 text-sm text-muted">Not in a class this year.</p>}
      {r && r.section && r.terms.length === 0 && <p className="mt-1 text-sm text-muted">No term with final marks yet.</p>}
      {r && r.terms.length > 0 && (
        <>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Term</th>
                  <th className="px-3 py-2 text-right font-semibold">Average</th>
                  <th className="px-3 py-2 text-right font-semibold">Rank</th>
                  <th className="px-3 py-2 text-right font-semibold">Class average</th>
                  <th className="px-3 py-2 font-semibold">Appreciation</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.terms.map((t) => (
                  <tr key={t.termId} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 font-medium">{t.name}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${t.result && !t.result.passed && t.result.average !== null ? "text-err" : ""}`}>
                      {avg(t.result?.average)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {t.result?.rank ? `${t.result.rank} / ${t.classified}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{avg(t.classAverage)}</td>
                    <td className="px-3 py-1.5 text-xs">{t.result?.appreciation ?? "Not classified"}</td>
                    <td className="px-3 py-1.5 text-xs text-muted">{t.published ? "Published" : "Not published yet"}</td>
                  </tr>
                ))}
              </tbody>
              {r.annual && (
                <tfoot className="border-t border-line bg-ground text-sm">
                  <tr>
                    <td className="px-3 py-2 font-semibold">Year</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${r.annual.decision === "repeat" ? "text-err" : ""}`}>
                      {avg(r.annual.average)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.annual.rank ? `${r.annual.rank} / ${r.classified}` : "—"}</td>
                    <td />
                    <td className="px-3 py-2 text-xs">{r.annual.appreciation ?? "Not classified"}</td>
                    <td className="px-3 py-2 text-xs font-semibold">
                      {r.annual.decision === "promoted" ? "Promoted" : r.annual.decision === "repeat" ? "Repeats the class" : ""}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {r.terms.map((t) =>
            t.result ? (
              <details key={t.termId} className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted">Subjects, {t.name}</summary>
                <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {t.result.subjects.map((l) => (
                    <li key={l.subjectId} className="flex justify-between gap-3">
                      <span>
                        {l.name} <span className="text-xs text-muted">×{l.coefficient}</span>
                      </span>
                      <span className={`font-mono ${l.average !== null && l.average < 10 ? "text-err" : ""}`}>
                        {avg(l.average)}
                        {l.rank ? <span className="ml-2 text-xs text-muted">rank {l.rank}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null,
          )}
          <p className="mt-2 text-xs text-muted">
            Published terms show the published results; the others count only locked marks. The year average is the mean of
            the term averages; promotion at 10/20.
          </p>
        </>
      )}
    </div>
  );
}

/** Create a student record, or edit one. */
function StudentForm(props: { student: Student | null; onDone: () => void }) {
  const s = props.student;
  const [matricule, setMatricule] = useState(s?.matricule ?? "");
  const [firstName, setFirstName] = useState(s?.firstName ?? "");
  const [lastName, setLastName] = useState(s?.lastName ?? "");
  const [gender, setGender] = useState<Gender | "">(s?.gender ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(s?.dateOfBirth ?? "");
  const [placeOfBirth, setPlaceOfBirth] = useState(s?.placeOfBirth ?? "");
  const [guardianName, setGuardianName] = useState(s?.guardian?.name ?? "");
  const [guardianPhone, setGuardianPhone] = useState(s?.guardian?.phone ?? "");
  const [guardianRelationship, setGuardianRelationship] = useState(s?.guardian?.relationship ?? "");
  const [admittedOn, setAdmittedOn] = useState(s?.admittedOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [createStudent, create] = useCreateStudentMutation();
  const [updateStudent, update] = useUpdateStudentMutation();
  const saving = create.isLoading || update.isLoading;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gender) return;
    setError(null);
    const fields = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gender,
      dateOfBirth: dateOfBirth || null,
      placeOfBirth: placeOfBirth.trim() || null,
      guardianName: guardianName.trim() || null,
      guardianPhone: guardianPhone.trim() || null,
      guardianRelationship: guardianRelationship.trim() || null,
      admittedOn: admittedOn || null,
    };
    try {
      if (!s) await createStudent({ ...fields, matricule: matricule.trim() || undefined }).unwrap();
      else await updateStudent({ id: s.id, body: { ...fields, matricule: matricule.trim() } }).unwrap();
      props.onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the student."));
    }
  }

  const ready = firstName.trim() && lastName.trim() && gender && (!s || matricule.trim());
  const field = (id: string, label: string, value: string, set: (v: string) => void, extra: { type?: string; placeholder?: string; optional?: boolean } = {}) => (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label} {extra.optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      <input
        id={id}
        type={extra.type ?? "text"}
        value={value}
        placeholder={extra.placeholder}
        onChange={(e) => set(e.target.value)}
        className={fieldClass}
      />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-line bg-white p-5" noValidate>
      <h2 className="font-semibold">{s ? `Edit ${s.fullName}` : "Add a student"}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {field("studentFirstName", "First name", firstName, setFirstName)}
        {field("studentLastName", "Last name", lastName, setLastName)}
        <div>
          <label htmlFor="studentMatricule" className={labelClass}>
            Matricule
          </label>
          <input
            id="studentMatricule"
            value={matricule}
            onChange={(e) => setMatricule(e.target.value)}
            placeholder={s ? undefined : "Generated if left empty"}
            className={`${fieldClass} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="studentGender" className={labelClass}>
            Gender
          </label>
          <select id="studentGender" value={gender} onChange={(e) => setGender(e.target.value as Gender | "")} className={fieldClass}>
            <option value="">Choose…</option>
            <option value="female">Girl</option>
            <option value="male">Boy</option>
          </select>
        </div>
        {field("studentBorn", "Date of birth", dateOfBirth, setDateOfBirth, { type: "date", optional: true })}
        {field("studentPlace", "Place of birth", placeOfBirth, setPlaceOfBirth, { optional: true })}
        {field("guardianName", "Parent or guardian", guardianName, setGuardianName, { optional: true })}
        {field("guardianPhone", "Guardian's phone", guardianPhone, setGuardianPhone, { type: "tel", placeholder: "+237 6XX XX XX XX", optional: true })}
        {field("guardianRelationship", "Relationship", guardianRelationship, setGuardianRelationship, { placeholder: "Mother, Father, Uncle…", optional: true })}
        {field("studentAdmitted", "Admitted on", admittedOn, setAdmittedOn, { type: "date", optional: true })}
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
          {error}
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={!ready || saving}
          className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : s ? "Save" : "Add student"}
        </button>
        <button type="button" onClick={props.onDone} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
