"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "@/components/layout/AppHeader";
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
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (!canView || !moduleOn) {
    return (
      <div className="flex flex-1 flex-col">
        <AppHeader />
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
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Students</h1>
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
    <section className="mt-6 rounded-xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{s ? s.fullName : "Loading…"}</h2>
          {s && (
            <p className="text-sm text-muted">
              {s.matricule} · {s.gender === "female" ? "Girl" : "Boy"} · born {formatDay(s.dateOfBirth)}
              {s.placeOfBirth ? ` in ${s.placeOfBirth}` : ""}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          Close
        </button>
      </div>
      {student.error && (
        <p role="alert" className="mt-3 text-sm text-err">
          {apiErrorMessage(student.error)}
        </p>
      )}
      {s && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Classes</h3>
          {s.enrollments.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Never enrolled in a class.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {s.enrollments.map((e) => (
                <li key={e.id}>
                  <strong>{e.year.name}</strong> · {e.section.label} · from {formatDay(e.enrolledOn)}
                  {e.leftOn && ` to ${formatDay(e.leftOn)}`}
                  {e.status !== "active" && <span className="text-muted"> ({e.status}{e.reason ? `: ${e.reason}` : ""})</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
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
