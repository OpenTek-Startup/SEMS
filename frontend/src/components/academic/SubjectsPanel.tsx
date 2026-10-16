"use client";

import { useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateSubjectMutation,
  useDeleteSubjectMutation,
  useGetSubjectsQuery,
  useUpdateSubjectMutation,
  type Subject,
} from "@/lib/api/academicApi";
import { dangerButton, Field, Notice, smallButton, smallPrimaryButton, type Message } from "./academicUi";

type Run = (action: () => Promise<unknown>, ok: string) => Promise<boolean>;

/** The subjects taught in the school (code + name). */
export default function SubjectsPanel({ canManage }: { canManage: boolean }) {
  const subjects = useGetSubjectsQuery();
  const [createSubject, creating] = useCreateSubjectMutation();
  const [message, setMessage] = useState<Message>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

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

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const done = await run(
      () => createSubject({ code: code.trim(), name: name.trim() }).unwrap(),
      `${name.trim()} added.`,
    );
    if (done) {
      setCode("");
      setName("");
    }
  }

  return (
    <section>
      <p className="text-sm text-muted">
        Subjects are shared by the whole school. Choose which classes study them, and their coefficients, in the
        Classes tab.
      </p>

      {canManage && (
        <form onSubmit={add} className="my-3 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-ground p-4">
          <Field label="Code" value={code} placeholder="MATH" onChange={setCode} width="w-28" />
          <Field label="Name" value={name} placeholder="Mathematics" onChange={setName} width="w-64" />
          <button type="submit" disabled={creating.isLoading} className={smallPrimaryButton}>
            {creating.isLoading ? "Saving…" : "Add subject"}
          </button>
        </form>
      )}

      <Notice message={message} />

      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
        {subjects.isLoading && <p className="p-5 text-sm text-muted">Loading subjects…</p>}
        {subjects.error && (
          <p role="alert" className="p-5 text-sm text-err">
            {apiErrorMessage(subjects.error)}
          </p>
        )}
        {subjects.data && subjects.data.length === 0 && <p className="p-5 text-sm text-muted">No subject yet.</p>}
        {subjects.data && subjects.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Classes</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {subjects.data.map((s) => (
                <SubjectRow key={s.id} subject={s} canManage={canManage} run={run} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function SubjectRow({ subject, canManage, run }: { subject: Subject; canManage: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(subject.code);
  const [name, setName] = useState(subject.name);
  const [updateSubject] = useUpdateSubjectMutation();
  const [deleteSubject] = useDeleteSubjectMutation();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const done = await run(
      () => updateSubject({ id: subject.id, code: code.trim(), name: name.trim() }).unwrap(),
      `${name.trim()} saved.`,
    );
    if (done) setEditing(false);
  }

  if (editing) {
    return (
      <tr className="border-t border-line first:border-t-0">
        <td colSpan={4} className="px-4 py-3">
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <Field label="Code" value={code} onChange={setCode} width="w-28" />
            <Field label="Name" value={name} onChange={setName} width="w-64" />
            <button type="submit" className={smallPrimaryButton}>
              Save
            </button>
            <button type="button" className={smallButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-line first:border-t-0">
      <td className="px-4 py-3 font-mono text-xs">{subject.code}</td>
      <td className="px-4 py-3 font-semibold">{subject.name}</td>
      <td className="px-4 py-3 text-muted">{subject.classCount}</td>
      <td className="px-4 py-3">
        {canManage && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={smallButton}
              onClick={() => {
                setCode(subject.code);
                setName(subject.name);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className={dangerButton}
              onClick={() => {
                if (window.confirm(`Delete the subject ${subject.name}?`)) {
                  void run(() => deleteSubject({ id: subject.id }).unwrap(), `${subject.name} deleted.`);
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
