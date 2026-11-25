"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useGetMarkSheetQuery,
  useMoveAssessmentMutation,
  useSaveMarksMutation,
  type MarkSheet,
  type SheetLine,
} from "@/lib/api/assessmentApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import AppHeader from "@/components/layout/AppHeader";
import { Badge, Notice, smallButton, smallPrimaryButton, type Message } from "@/components/academic/academicUi";

const shown = (l: SheetLine) => (l.absent ? "ABS" : l.score === null ? "" : String(l.score));

/** /assessment/[id] — the mark sheet of one assessment: one line per student, ABS for absent. */
export default function MarkSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const sheet = useGetMarkSheetQuery(id, { skip: !id });

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Link href="/assessment" className="text-sm text-brand hover:underline">
          ← All assessments
        </Link>
        {sheet.isLoading && <p className="mt-4 text-sm text-muted">Loading the mark sheet…</p>}
        {sheet.error && (
          <p role="alert" className="mt-4 rounded-lg bg-err-bg p-4 text-sm text-err">
            {apiErrorMessage(sheet.error)}
          </p>
        )}
        {/* Re-mount when the server's sheet changes, so the typed values start from it. */}
        {sheet.data && <SheetEditor key={sheet.fulfilledTimeStamp} sheet={sheet.data} />}
      </main>
    </div>
  );
}

function SheetEditor({ sheet }: { sheet: MarkSheet }) {
  const a = sheet.assessment;
  const canEnter = useCan(PERMISSIONS.marksEnter);
  const canOverride = useCan(PERMISSIONS.marksOverride);
  const editable = (sheet.editing === "open" && canEnter) || (sheet.editing === "override" && canOverride);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(sheet.students.map((l) => [l.studentId, shown(l)])),
  );
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>(null);
  const [saveMarks, saving] = useSaveMarksMutation();
  const [move, moving] = useMoveAssessmentMutation();

  const changed = sheet.students.filter((l) => (values[l.studentId] ?? "").trim().toUpperCase() !== shown(l).toUpperCase());

  async function save(): Promise<boolean> {
    setMessage(null);
    setErrors({});
    if (changed.length === 0) return true;
    try {
      await saveMarks({
        id: a.id,
        marks: changed.map((l) => ({ studentId: l.studentId, value: (values[l.studentId] ?? "").trim() || null })),
        reason: sheet.editing === "override" ? reason.trim() : undefined,
      }).unwrap();
      setMessage({ kind: "ok", text: `${changed.length} mark${changed.length === 1 ? "" : "s"} saved.` });
      return true;
    } catch (err) {
      const list = (err as { data?: { error?: { errors?: { studentId: string; message: string }[] } } }).data?.error?.errors;
      if (list) setErrors(Object.fromEntries(list.map((e) => [e.studentId, e.message])));
      setMessage({ kind: "error", text: apiErrorMessage(err) });
      return false;
    }
  }

  async function submit() {
    if (!(await save())) return;
    setMessage(null);
    try {
      await move({ id: a.id, action: "submit" }).unwrap();
      setMessage({ kind: "ok", text: "Marks submitted. The exam officer will validate them." });
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  /** Enter moves to the next student, as on paper. */
  function next(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    document.getElementById(`mark-${index + 1}`)?.focus();
  }

  const s = sheet.summary;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {a.name} · {a.subject.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {a.section.label} · {a.term.name} · out of {a.maxScore}
            {a.weight > 1 ? ` · weight ${a.weight}` : ""}
          </p>
        </div>
        <Badge tone={a.status === "open" ? "muted" : "ok"}>{a.status}</Badge>
      </div>

      <p className="mt-4 text-sm">
        {s.marked} marked, {s.absent} absent, {s.missing} missing of {s.students}
        {s.average !== null && ` · average ${s.average}/${a.maxScore} · highest ${s.highest} · lowest ${s.lowest}`}
        {s.marked > 0 && ` · ${s.passed} at or above ${a.maxScore / 2}`}
      </p>
      {sheet.editing === "closed" && (
        <p className="mt-3 rounded-lg bg-ground p-3 text-sm text-muted">
          Submitted: waiting for the exam officer. To change a mark, ask for the assessment to be sent back.
        </p>
      )}
      {sheet.editing === "override" && (
        <p className="mt-3 rounded-lg bg-warn-bg p-3 text-sm text-warn">
          These marks are locked.{" "}
          {canOverride ? "A change needs a reason and is kept in the audit log." : "Only the exam officer can change them."}
        </p>
      )}
      <Notice message={message} />

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
        {sheet.students.length === 0 ? (
          <p className="p-5 text-sm text-muted">No student in {a.section.label} yet. Add them on the Classes page.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Student</th>
                <th className="px-4 py-2 font-semibold">Matricule</th>
                <th className="w-40 px-4 py-2 font-semibold">Mark /{a.maxScore}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.students.map((l, i) => (
                <tr key={l.studentId} className={`border-b border-line last:border-0 ${l.inSection ? "" : "text-muted"}`}>
                  <td className="px-4 py-1.5 text-muted">{i + 1}</td>
                  <td className="px-4 py-1.5">
                    {l.fullName}
                    {!l.inSection && <span className="ml-1 text-xs">(left the section)</span>}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-xs">{l.matricule}</td>
                  <td className="px-4 py-1.5">
                    {editable ? (
                      <>
                        <input
                          id={`mark-${i}`}
                          aria-label={`Mark of ${l.fullName}`}
                          value={values[l.studentId] ?? ""}
                          onChange={(e) => setValues({ ...values, [l.studentId]: e.target.value })}
                          onKeyDown={(e) => next(e, i)}
                          inputMode="decimal"
                          placeholder="—"
                          className={`h-8 w-24 rounded-md border bg-white px-2 text-right font-mono outline-none focus:ring-2 focus:ring-brand/20 ${
                            errors[l.studentId] ? "border-err" : "border-line focus:border-brand"
                          }`}
                        />
                        {errors[l.studentId] && <p className="mt-0.5 text-xs text-err">{errors[l.studentId]}</p>}
                      </>
                    ) : (
                      <span className="font-mono">{shown(l) || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editable && sheet.students.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {sheet.editing === "override" && (
            <label className="block min-w-72 flex-1 text-xs font-medium text-muted">
              Reason for the change (kept in the audit log)
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Script re-marked after appeal"
                className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
          )}
          <button type="button" className={smallButton} disabled={saving.isLoading || changed.length === 0} onClick={() => void save()}>
            {saving.isLoading ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Saved"}
          </button>
          {sheet.editing === "open" && (
            <button type="button" className={smallPrimaryButton} disabled={saving.isLoading || moving.isLoading} onClick={() => void submit()}>
              Save and submit
            </button>
          )}
          <p className="w-full text-xs text-muted">Type a mark such as 12.5 or 12,5; ABS for absent; leave empty if not marked yet. Enter goes to the next student.</p>
        </div>
      )}
    </>
  );
}
