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
import { Badge, Notice, smallButton, smallPrimaryButton, type Message } from "@/components/academic/academicUi";

const shown = (l: SheetLine) => (l.absent ? "ABS" : l.score === null ? "" : String(l.score));

/** /assessment/[id] — the mark sheet of one assessment: one line per student, ABS for absent. */
export default function MarkSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const sheet = useGetMarkSheetQuery(id, { skip: !id });

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
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
  const half = a.maxScore / 2;
  const missingNow = sheet.students.filter((l) => l.inSection && (values[l.studentId] ?? "").trim() === "").length;
  const figures: { label: string; value: string }[] = [
    { label: "Marks entered", value: `${s.marked + s.absent} / ${s.students}` },
    { label: "Class average", value: s.average !== null ? String(s.average) : "—" },
    { label: "Highest", value: s.highest !== null ? String(s.highest) : "—" },
    { label: "Lowest", value: s.lowest !== null ? String(s.lowest) : "—" },
    { label: `At or above ${half}`, value: s.marked > 0 ? `${Math.round((s.passed / s.marked) * 100)}%` : "—" },
  ];

  /** The flag beside a line, from what is typed now. */
  function flag(l: SheetLine): { text: string; tone: string } | null {
    const v = (values[l.studentId] ?? "").trim().toUpperCase();
    if (v === "ABS") return { text: "Absent", tone: "text-muted" };
    if (v === "") return l.inSection ? { text: "Missing", tone: "text-warn" } : null;
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n) && n < half) return { text: `Below ${half}`, tone: "text-err" };
    return null;
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Mark entry</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold">
            {a.section.label} · {a.subject.name} · {a.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Out of {a.maxScore} · {a.term.name}
              {a.weight > 1 ? ` · weight ${a.weight}` : ""}
            </span>
            <Badge tone={a.status === "open" ? "muted" : "ok"}>{a.status}</Badge>
            {editable && missingNow > 0 && (
              <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">
                {missingNow} mark{missingNow === 1 ? "" : "s"} missing
              </span>
            )}
          </p>
        </div>
        {editable && sheet.editing === "open" && sheet.students.length > 0 && (
          <button
            type="button"
            className={smallPrimaryButton}
            disabled={saving.isLoading || moving.isLoading || missingNow > 0}
            title={missingNow > 0 ? "Every student needs a mark or ABS before submitting" : undefined}
            onClick={() => void submit()}
          >
            Submit for validation
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {figures.map((f) => (
          <div key={f.label} className="rounded-xl border border-line bg-white px-4 py-3">
            <p className="text-[13px] text-muted">{f.label}</p>
            <p className="mt-0.5 font-mono text-xl font-semibold">{f.value}</p>
          </div>
        ))}
      </div>

      {sheet.editing === "closed" && (
        <p className="mt-4 rounded-lg bg-ground p-3 text-sm text-muted">
          Submitted: waiting for the exam officer. To change a mark, ask for the assessment to be sent back.
        </p>
      )}
      {sheet.editing === "override" && (
        <p className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn">
          These marks are locked.{" "}
          {canOverride ? "A change needs a reason and is kept in the audit log." : "Only the exam officer can change them."}
        </p>
      )}
      <Notice message={message} />

      <div className="mt-4 rounded-xl border border-line bg-white">
        {sheet.students.length === 0 ? (
          <p className="p-5 text-sm text-muted">No student in {a.section.label} yet. Add them on the Classes page.</p>
        ) : (
          <ol className="grid md:grid-cols-2">
            {sheet.students.map((l, i) => {
              const f = flag(l);
              return (
                <li
                  key={l.studentId}
                  className={`flex items-center gap-3 border-b border-line px-4 py-2 md:odd:border-r ${l.inSection ? "" : "text-muted"}`}
                >
                  <span className="w-6 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{l.fullName}</span>
                    <span className="block font-mono text-[11px] text-muted">
                      {l.matricule}
                      {!l.inSection && " · left the section"}
                    </span>
                  </span>
                  {f && <span className={`shrink-0 text-xs font-medium ${f.tone}`}>{f.text}</span>}
                  {editable ? (
                    <span className="shrink-0">
                      <input
                        id={`mark-${i}`}
                        aria-label={`Mark of ${l.fullName}`}
                        value={values[l.studentId] ?? ""}
                        onChange={(e) => setValues({ ...values, [l.studentId]: e.target.value })}
                        onKeyDown={(e) => next(e, i)}
                        inputMode="decimal"
                        placeholder="—"
                        className={`h-9 w-20 rounded-md border px-2 text-right font-mono outline-none focus:ring-2 focus:ring-brand/20 ${
                          errors[l.studentId]
                            ? "border-err bg-err-bg"
                            : f?.text === "Missing"
                              ? "border-warn bg-warn-bg focus:border-brand"
                              : "border-line bg-white focus:border-brand"
                        }`}
                      />
                      {errors[l.studentId] && <span className="mt-0.5 block text-[11px] text-err">{errors[l.studentId]}</span>}
                    </span>
                  ) : (
                    <span className="w-20 shrink-0 text-right font-mono">{shown(l) || "—"}</span>
                  )}
                </li>
              );
            })}
          </ol>
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
          <p className="w-full text-xs text-muted">Type a mark such as 12.5 or 12,5; ABS for absent; leave empty if not marked yet. Enter goes to the next student.</p>
        </div>
      )}
    </>
  );
}
