"use client";

import { useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateClassMutation,
  useCreateSectionMutation,
  useDeleteClassMutation,
  useDeleteSectionMutation,
  useGetClassesQuery,
  useGetSubjectsQuery,
  useSetClassSubjectsMutation,
  useUpdateClassMutation,
  type SchoolClass,
  type Subject,
} from "@/lib/api/academicApi";
import { Badge, dangerButton, Field, Notice, smallButton, smallPrimaryButton, type Message } from "./academicUi";

type Run = (action: () => Promise<unknown>, ok: string) => Promise<boolean>;

/** Classes (levels) with their sections and their subjects and coefficients. */
export default function ClassesPanel({ canManage }: { canManage: boolean }) {
  const classes = useGetClassesQuery();
  const subjects = useGetSubjectsQuery();
  const [createClass, creating] = useCreateClassMutation();
  const [message, setMessage] = useState<Message>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");

  const run: Run = async (action, ok) => {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
      return false;
    }
  };

  async function addClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    const done = await run(() => createClass({ name: clean, level: Number(level) }).unwrap(), `Class ${clean} created.`);
    if (done) {
      setAdding(false);
      setName("");
      setLevel("");
    }
  }

  const nextLevel = (classes.data ?? []).reduce((max, c) => Math.max(max, c.level), 0) + 1;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted">
          Students are enrolled into sections (Form 1 A, Form 1 B…). Coefficients weigh each subject in the averages.
        </p>
        {canManage && !adding && (
          <button
            type="button"
            className={smallPrimaryButton}
            onClick={() => {
              setLevel(String(nextLevel));
              setAdding(true);
            }}
          >
            Add a class
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={addClass} className="my-3 rounded-lg border border-line bg-ground p-4">
          <p className="text-sm font-semibold">New class</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Name" value={name} placeholder="Form 1" onChange={setName} />
            <Field label="Level (order)" type="number" value={level} onChange={setLevel} width="w-28" />
            <button type="submit" disabled={creating.isLoading} className={smallPrimaryButton}>
              {creating.isLoading ? "Saving…" : "Create class"}
            </button>
            <button type="button" className={smallButton} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <Notice message={message} />

      {classes.isLoading && <p className="mt-6 text-sm text-muted">Loading classes…</p>}
      {classes.error && (
        <p role="alert" className="mt-6 text-sm text-err">
          {apiErrorMessage(classes.error)}
        </p>
      )}
      {classes.data && classes.data.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-white p-6 text-sm text-muted">
          No class yet.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {classes.data?.map((c) => (
          <ClassCard key={c.id} schoolClass={c} subjects={subjects.data ?? []} canManage={canManage} run={run} />
        ))}
      </div>
    </section>
  );
}

function ClassCard(props: { schoolClass: SchoolClass; subjects: Subject[]; canManage: boolean; run: Run }) {
  const { schoolClass: c, canManage, run } = props;
  const [editing, setEditing] = useState(false);
  const [editingSubjects, setEditingSubjects] = useState(false);
  const [name, setName] = useState(c.name);
  const [level, setLevel] = useState(String(c.level));
  const [sectionName, setSectionName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [updateClass] = useUpdateClassMutation();
  const [deleteClass] = useDeleteClassMutation();
  const [createSection, creatingSection] = useCreateSectionMutation();
  const [deleteSection] = useDeleteSectionMutation();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const done = await run(
      () => updateClass({ id: c.id, name: name.trim(), level: Number(level) }).unwrap(),
      `${name.trim()} saved.`,
    );
    if (done) setEditing(false);
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = sectionName.trim();
    const done = await run(
      () =>
        createSection({ classId: c.id, name: clean, capacity: capacity ? Number(capacity) : null }).unwrap(),
      `Section ${c.name} ${clean} added.`,
    );
    if (done) {
      setSectionName("");
      setCapacity("");
    }
  }

  return (
    <article className="rounded-xl border border-line bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        {editing ? (
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Level" type="number" value={level} onChange={setLevel} width="w-24" />
            <button type="submit" className={smallPrimaryButton}>
              Save
            </button>
            <button type="button" className={smallButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {c.name}
            <Badge tone="muted">Level {c.level}</Badge>
          </h2>
        )}
        {canManage && !editing && (
          <div className="flex gap-2">
            <button
              type="button"
              className={smallButton}
              onClick={() => {
                setName(c.name);
                setLevel(String(c.level));
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className={dangerButton}
              onClick={() => {
                if (window.confirm(`Delete the class ${c.name}?`)) {
                  void run(() => deleteClass({ id: c.id }).unwrap(), `${c.name} deleted.`);
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </header>

      <div className="grid gap-6 px-5 py-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Sections</h3>
          {c.sections.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No section yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {c.sections.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                  <span className="font-semibold">{s.label}</span>
                  {s.capacity !== null && <span className="text-xs text-muted">{s.capacity} places</span>}
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Delete section ${s.label}`}
                      className="text-xs text-err hover:underline"
                      onClick={() => {
                        if (window.confirm(`Delete the section ${s.label}?`)) {
                          void run(() => deleteSection({ id: s.id }).unwrap(), `${s.label} deleted.`);
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form onSubmit={addSection} className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="New section" value={sectionName} placeholder="A" onChange={setSectionName} width="w-28" />
              <Field
                label="Places (optional)"
                type="number"
                value={capacity}
                onChange={setCapacity}
                required={false}
                width="w-32"
              />
              <button type="submit" disabled={creatingSection.isLoading} className={smallButton}>
                Add section
              </button>
            </form>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Subjects · total coefficient {c.totalCoefficient}
            </h3>
            {canManage && !editingSubjects && (
              <button type="button" className={smallButton} onClick={() => setEditingSubjects(true)}>
                Edit subjects
              </button>
            )}
          </div>
          {editingSubjects ? (
            <SubjectsEditor
              schoolClass={c}
              subjects={props.subjects}
              run={run}
              onDone={() => setEditingSubjects(false)}
            />
          ) : c.subjects.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No subject yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <tbody>
                {c.subjects.map((s) => (
                  <tr key={s.subjectId} className="border-t border-line first:border-t-0">
                    <td className="py-1.5 pr-2 font-mono text-xs text-muted">{s.code}</td>
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5 text-right font-semibold">×{s.coefficient}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </article>
  );
}

/** Tick the subjects of the class and set their coefficients, then save the whole list. */
function SubjectsEditor(props: { schoolClass: SchoolClass; subjects: Subject[]; run: Run; onDone: () => void }) {
  const { schoolClass: c } = props;
  const [setClassSubjects, saving] = useSetClassSubjectsMutation();
  // subjectId -> coefficient (as typed); absent = not taught in this class
  const [chosen, setChosen] = useState<Map<string, string>>(
    () => new Map(c.subjects.map((s) => [s.subjectId, String(s.coefficient)])),
  );

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "1");
      return next;
    });
  }

  function setCoefficient(id: string, value: string) {
    setChosen((prev) => new Map(prev).set(id, value));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subjects = [...chosen.entries()].map(([subjectId, coefficient]) => ({
      subjectId,
      coefficient: Number(coefficient),
    }));
    const done = await props.run(
      () => setClassSubjects({ classId: c.id, subjects }).unwrap(),
      `Subjects of ${c.name} saved.`,
    );
    if (done) props.onDone();
  }

  if (props.subjects.length === 0) {
    return (
      <div className="mt-2 text-sm text-muted">
        Create the school&apos;s subjects first (Subjects tab).{" "}
        <button type="button" className="text-brand hover:underline" onClick={props.onDone}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mt-2">
      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
        {props.subjects.map((s) => {
          const on = chosen.has(s.id);
          return (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                <span className="font-mono text-xs text-muted">{s.code}</span>
                {s.name}
              </label>
              {on && (
                <input
                  type="number"
                  min={1}
                  max={20}
                  aria-label={`Coefficient of ${s.name}`}
                  value={chosen.get(s.id)}
                  onChange={(e) => setCoefficient(s.id, e.target.value)}
                  className="h-8 w-16 rounded border border-line px-2 text-right"
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={saving.isLoading} className={smallPrimaryButton}>
          {saving.isLoading ? "Saving…" : "Save subjects"}
        </button>
        <button type="button" className={smallButton} onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
