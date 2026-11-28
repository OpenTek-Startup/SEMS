"use client";

import Link from "next/link";
import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import type { SchoolClass } from "@/lib/api/academicApi";
import {
  useGetAssessmentsQuery,
  useMoveAssessmentMutation,
  type Assessment,
  type AssessmentAction,
} from "@/lib/api/assessmentApi";
import type { Message } from "@/components/academic/academicUi";

const selectClass =
  "mt-1 h-10 w-full rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/** How a cell of the board looks, by status. */
const CELL = {
  locked: { text: "Locked", className: "bg-brand text-white border-brand" },
  validated: { text: "Validated", className: "bg-brand-tint text-brand border-brand/30" },
  submitted: { text: "Submitted", className: "bg-white text-brand border-brand border-dashed" },
  open: { text: "Entering", className: "bg-warn-bg text-warn border-warn/30" },
} as const;

/**
 * The exam officer's board (mockup 11): for one class and one sequence, every
 * subject of every section with its status. A click validates a submitted
 * sheet or locks a validated one; "Lock validated" locks a whole section.
 */
export default function ValidationBoard(props: {
  termId: string;
  classes: SchoolClass[];
  canLock: boolean;
  onMessage: (m: Message) => void;
}) {
  const { termId, classes } = props;
  const all = useGetAssessmentsQuery({ termId }, { skip: !termId });
  const [classId, setClassId] = useState("");
  const [name, setName] = useState("");
  const [move, moving] = useMoveAssessmentMutation();
  const [bulk, setBulk] = useState<string | null>(null);

  const schoolClass = classes.find((c) => c.id === classId) ?? classes.find((c) => c.sections.length > 0);
  const sectionIds = new Set(schoolClass?.sections.map((s) => s.id) ?? []);
  const inClass = (all.data ?? []).filter((a) => sectionIds.has(a.section.id));
  const names = [...new Set(inClass.map((a) => a.name))].sort();
  const chosenName = names.includes(name) ? name : (names[names.length - 1] ?? "");
  const sheets = inClass.filter((a) => a.name === chosenName);
  const at = (sectionId: string, subjectId: string): Assessment | undefined =>
    sheets.find((a) => a.section.id === sectionId && a.subject.id === subjectId);

  if (!schoolClass) return null;

  const total = schoolClass.sections.length * schoolClass.subjects.length;
  const count = (status: Assessment["status"]) => sheets.filter((a) => a.status === status).length;
  const counts = { locked: count("locked"), validated: count("validated"), submitted: count("submitted"), open: count("open") };
  const notStarted = total - sheets.length;

  async function step(a: Assessment, action: AssessmentAction) {
    props.onMessage(null);
    try {
      await move({ id: a.id, action }).unwrap();
      props.onMessage({ kind: "ok", text: `${a.subject.name}, ${a.section.label}: ${action === "lock" ? "locked" : "validated"}.` });
    } catch (err) {
      props.onMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  /** Locks every validated sheet of a section, one after another. */
  async function lockSection(sectionId: string, label: string) {
    const ready = sheets.filter((a) => a.section.id === sectionId && a.status === "validated");
    if (ready.length === 0 || !window.confirm(`Lock ${ready.length} validated mark sheet${ready.length === 1 ? "" : "s"} of ${label}?`)) return;
    props.onMessage(null);
    setBulk(sectionId);
    let done = 0;
    try {
      for (const a of ready) {
        await move({ id: a.id, action: "lock" }).unwrap();
        done++;
      }
      props.onMessage({ kind: "ok", text: `${label}: ${done} mark sheet${done === 1 ? "" : "s"} locked.` });
    } catch (err) {
      props.onMessage({ kind: "error", text: `${label}: ${done} locked, then: ${apiErrorMessage(err)}` });
    } finally {
      setBulk(null);
    }
  }

  return (
    <section aria-labelledby="board-title" className="mt-6 rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="board-title" className="text-lg font-semibold">
            Validate &amp; lock{chosenName ? ` · ${schoolClass.name} · ${chosenName}` : ""}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-white">Locked · {counts.locked}</span>
            <span className="rounded-full bg-brand-tint px-2.5 py-0.5 text-brand">Validated · {counts.validated}</span>
            <span className="rounded-full border border-dashed border-brand px-2.5 py-0.5 text-brand">Submitted · {counts.submitted}</span>
            <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-warn">Entering · {counts.open}</span>
            <span className="rounded-full bg-ground px-2.5 py-0.5 text-muted">Not started · {notStarted}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="block w-40 text-xs font-medium text-muted">
            Class
            <select value={schoolClass.id} onChange={(e) => setClassId(e.target.value)} className={selectClass}>
              {classes
                .filter((c) => c.sections.length > 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block w-44 text-xs font-medium text-muted">
            Assessment
            <select value={chosenName} onChange={(e) => setName(e.target.value)} className={selectClass} disabled={names.length === 0}>
              {names.length === 0 && <option value="">None yet</option>}
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {all.isLoading ? (
        <p className="p-5 text-sm text-muted">Loading…</p>
      ) : names.length === 0 ? (
        <p className="p-5 text-sm text-muted">No assessment in {schoolClass.name} for this term yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Subject</th>
                {schoolClass.sections.map((s) => {
                  const ready = sheets.filter((a) => a.section.id === s.id && a.status === "validated").length;
                  return (
                    <th key={s.id} className="min-w-36 px-2 py-3 font-semibold">
                      <span className="block text-sm normal-case tracking-normal text-ink">{s.label}</span>
                      {props.canLock && (
                        <button
                          type="button"
                          disabled={ready === 0 || moving.isLoading || bulk !== null}
                          onClick={() => void lockSection(s.id, s.label)}
                          className="mt-1.5 h-7 w-full rounded-md border border-line bg-white px-2 text-[11px] font-semibold normal-case tracking-normal text-brand hover:bg-brand-tint disabled:text-muted disabled:opacity-60"
                        >
                          {bulk === s.id ? "Locking…" : `Lock validated (${ready})`}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {schoolClass.subjects.map((sub) => (
                <tr key={sub.subjectId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    {sub.name} <span className="text-xs text-muted">· coef {sub.coefficient}</span>
                  </td>
                  {schoolClass.sections.map((s) => {
                    const a = at(s.id, sub.subjectId);
                    if (!a) {
                      return (
                        <td key={s.id} className="px-2 py-2">
                          <span className="flex h-9 items-center justify-center rounded-md bg-ground text-xs text-muted">Not started</span>
                        </td>
                      );
                    }
                    const look = CELL[a.status];
                    const action: AssessmentAction | null =
                      a.status === "submitted" ? "validate" : a.status === "validated" && props.canLock ? "lock" : null;
                    return (
                      <td key={s.id} className="px-2 py-2">
                        {action ? (
                          <button
                            type="button"
                            disabled={moving.isLoading || bulk !== null}
                            onClick={() => void step(a, action)}
                            title={action === "validate" ? "Click to validate" : "Click to lock"}
                            className={`flex h-9 w-full items-center justify-center rounded-md border text-xs font-semibold hover:opacity-85 disabled:opacity-60 ${look.className}`}
                          >
                            {action === "validate" ? "Validate" : "Lock"}
                          </button>
                        ) : (
                          <Link
                            href={`/assessment/${a.id}`}
                            className={`flex h-9 w-full items-center justify-center rounded-md border text-xs font-semibold ${look.className}`}
                          >
                            {look.text}
                          </Link>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {names.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
          <span>
            {counts.locked} of {total} mark sheets locked.{" "}
            {counts.locked === total ? "This sequence is final for the class." : "Results become final when every sheet of the term is locked."}
          </span>
          <Link href="/results" className="font-semibold text-brand hover:underline">
            Open the results →
          </Link>
        </div>
      )}
    </section>
  );
}
