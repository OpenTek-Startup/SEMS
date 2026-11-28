"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import { useGetClassesQuery, useGetYearsQuery } from "@/lib/api/academicApi";
import {
  useCreateAssessmentMutation,
  useDeleteAssessmentMutation,
  useGetAssessmentsQuery,
  useMoveAssessmentMutation,
  useUpdateAssessmentMutation,
  type Assessment,
  type AssessmentAction,
  type AssessmentStatus,
} from "@/lib/api/assessmentApi";
import { useGetMyTeachingQuery } from "@/lib/api/teachingApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";
import ValidationBoard from "@/components/assessment/ValidationBoard";
import {
  Badge,
  dangerButton,
  Field,
  formatDay,
  Notice,
  smallButton,
  smallPrimaryButton,
  type Message,
} from "@/components/academic/academicUi";

const STATUS_LABEL: Record<AssessmentStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  validated: "Validated",
  locked: "Locked",
};

const STATUS_TONE: Record<AssessmentStatus, "brand" | "ok" | "muted"> = {
  open: "muted",
  submitted: "brand",
  validated: "ok",
  locked: "ok",
};

const ACTION_DONE: Record<AssessmentAction, string> = {
  submit: "submitted for validation",
  validate: "validated",
  reopen: "sent back to the teacher",
  lock: "locked",
};

const selectClass =
  "mt-1 h-10 w-full rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/** A subject in a section that the user may create assessments for. */
interface Cell {
  key: string;
  sectionId: string;
  subjectId: string;
  label: string;
}

/**
 * /assessment — tests, sequences and exams (module "assessment").
 * Teachers see and create assessments for their own classes and submit them;
 * the exam officer validates, sends back and locks. Marks entry comes with
 * the Enrollment module (the students of each section).
 */
export default function AssessmentBoard() {
  const school = useAppSelector((state) => state.auth.user?.school);
  const canView = useCan(PERMISSIONS.academicView);
  const canCreate = useCan(PERMISSIONS.assessmentCreate);
  const canSubmit = useCan(PERMISSIONS.marksEnter);
  const canValidate = useCan(PERMISSIONS.marksValidate);
  const canLock = useCan(PERMISSIONS.marksLock);
  const modules = useActiveModules();
  const active = modules.codes.has("assessment");
  const teachingOn = modules.codes.has("staff") && modules.codes.has("academic");
  const skip = !canView || !active;

  const years = useGetYearsQuery(undefined, { skip });
  const currentYear = years.data?.find((y) => y.isCurrent);
  const [termId, setTermId] = useState<string | null>(null);
  const [status, setStatus] = useState<AssessmentStatus | "">("");
  const chosenTerm = termId ?? currentYear?.terms.find((t) => t.isCurrent)?.id ?? "";

  const list = useGetAssessmentsQuery({ termId: chosenTerm || undefined, status: status || undefined }, { skip });
  const classes = useGetClassesQuery(undefined, { skip: skip || !canValidate });
  const mine = useGetMyTeachingQuery(undefined, { skip: skip || canValidate || !teachingOn });

  // Where the user may create: every class subject for the exam officer and administrator, own classes for a teacher.
  const cells: Cell[] = useMemo(() => {
    if (canValidate) {
      return (classes.data ?? []).flatMap((c) =>
        c.sections.flatMap((s) =>
          c.subjects.map((sub) => ({
            key: `${s.id}|${sub.subjectId}`,
            sectionId: s.id,
            subjectId: sub.subjectId,
            label: `${s.label} · ${sub.name}`,
          })),
        ),
      );
    }
    return (mine.data?.classes ?? []).map((c) => ({
      key: `${c.sectionId}|${c.subjectId}`,
      sectionId: c.sectionId,
      subjectId: c.subjectId,
      label: `${c.label} · ${c.name}`,
    }));
  }, [canValidate, classes.data, mine.data]);

  const [message, setMessage] = useState<Message>(null);
  const [move, moving] = useMoveAssessmentMutation();
  const [remove, removing] = useDeleteAssessmentMutation();
  const [editing, setEditing] = useState<string | null>(null);

  let blocked: string | null = null;
  if (!school) blocked = "Assessments belong to a school. Sign in to a school to see them.";
  else if (!canView) blocked = "You do not have permission to see assessments in this school.";
  else if (!modules.isLoading && !active) blocked = "The Assessment module is not active for your school.";

  async function run(action: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
      return false;
    }
  }

  const step = (a: Assessment, action: AssessmentAction) =>
    run(() => move({ id: a.id, action }).unwrap(), `${a.name} (${a.section.label}, ${a.subject.name}) ${ACTION_DONE[action]}.`);

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <p className="text-sm text-muted">Academics</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold">Assessments &amp; marks</h1>
        {blocked ? (
          <p role="alert" className="mt-4 rounded-lg bg-warn-bg p-4 text-sm text-warn">
            {blocked}
          </p>
        ) : modules.isLoading || years.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : !currentYear ? (
          <p className="mt-4 rounded-lg bg-ground p-4 text-sm text-muted">
            There is no current academic year yet. Set one up in Academic structure first.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {currentYear.name} · Teachers create their tests and sequences and submit them; the exam officer
              validates and locks them. Open &ldquo;Marks&rdquo; to fill in the mark sheet.
            </p>

            {canCreate && (
              <CreateForm
                terms={currentYear.terms}
                defaultTermId={chosenTerm}
                cells={cells}
                noClassesHint={
                  canValidate
                    ? "Add classes, sections and class subjects in Academic structure first."
                    : "You have no class assigned this year. Ask the administrator to assign you in Academic structure → Teachers."
                }
                onDone={setMessage}
              />
            )}

            <div className="mt-6 flex flex-wrap items-end gap-3">
              <label className="block w-48 text-xs font-medium text-muted">
                Term
                <select value={chosenTerm} onChange={(e) => setTermId(e.target.value)} className={selectClass}>
                  <option value="">Whole year</option>
                  {currentYear.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isCurrent ? " (now)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block w-40 text-xs font-medium text-muted">
                Status
                <select value={status} onChange={(e) => setStatus(e.target.value as AssessmentStatus | "")} className={selectClass}>
                  <option value="">All</option>
                  {(Object.keys(STATUS_LABEL) as AssessmentStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <Notice message={message} />

            {canValidate && chosenTerm && classes.data && classes.data.length > 0 && (
              <ValidationBoard termId={chosenTerm} classes={classes.data} canLock={canLock} onMessage={setMessage} />
            )}

            <h2 className="mt-8 text-sm font-semibold tracking-wider text-muted uppercase">All assessments</h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
              {list.isLoading && <p className="p-5 text-sm text-muted">Loading assessments…</p>}
              {list.error && (
                <p role="alert" className="p-5 text-sm text-err">
                  {apiErrorMessage(list.error)}
                </p>
              )}
              {list.data && list.data.length === 0 && <p className="p-5 text-sm text-muted">No assessment here yet.</p>}
              {list.data && list.data.length > 0 && (
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Class</th>
                      <th className="px-4 py-3 font-semibold">Subject</th>
                      <th className="px-4 py-3 font-semibold">Assessment</th>
                      <th className="px-4 py-3 font-semibold">Out of</th>
                      <th className="px-4 py-3 font-semibold">Weight</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.map((a) =>
                      editing === a.id ? (
                        <EditRow key={a.id} assessment={a} onClose={() => setEditing(null)} onDone={setMessage} />
                      ) : (
                        <tr key={a.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2">{a.section.label}</td>
                          <td className="px-4 py-2">{a.subject.name}</td>
                          <td className="px-4 py-2">
                            <span className="font-medium">{a.name}</span>
                            {!chosenTerm && <span className="text-muted"> · {a.term.name}</span>}
                          </td>
                          <td className="px-4 py-2">{a.maxScore}</td>
                          <td className="px-4 py-2">{a.weight}</td>
                          <td className="px-4 py-2">{a.heldOn ? formatDay(a.heldOn) : "—"}</td>
                          <td className="px-4 py-2">
                            <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Link href={`/assessment/${a.id}`} className={`${smallButton} inline-flex items-center`}>
                                Marks
                              </Link>
                              {a.status === "open" && canCreate && (
                                <button type="button" className={smallButton} onClick={() => setEditing(a.id)}>
                                  Edit
                                </button>
                              )}
                              {a.status === "open" && canSubmit && (
                                <button type="button" className={smallButton} disabled={moving.isLoading} onClick={() => step(a, "submit")}>
                                  Submit
                                </button>
                              )}
                              {a.status === "submitted" && canValidate && (
                                <button type="button" className={smallButton} disabled={moving.isLoading} onClick={() => step(a, "validate")}>
                                  Validate
                                </button>
                              )}
                              {a.status === "validated" && canLock && (
                                <button type="button" className={smallButton} disabled={moving.isLoading} onClick={() => step(a, "lock")}>
                                  Lock
                                </button>
                              )}
                              {(a.status === "submitted" || a.status === "validated") && canValidate && (
                                <button type="button" className={smallButton} disabled={moving.isLoading} onClick={() => step(a, "reopen")}>
                                  Send back
                                </button>
                              )}
                              {a.status === "open" && canCreate && (
                                <button
                                  type="button"
                                  className={dangerButton}
                                  disabled={removing.isLoading}
                                  onClick={() => {
                                    if (window.confirm(`Delete ${a.name} for ${a.section.label}, ${a.subject.name}?`)) {
                                      void run(() => remove(a.id).unwrap(), `${a.name} deleted.`);
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CreateForm(props: {
  terms: { id: string; name: string; startDate: string; endDate: string }[];
  defaultTermId: string;
  cells: Cell[];
  noClassesHint: string;
  onDone: (message: Message) => void;
}) {
  const [create, creating] = useCreateAssessmentMutation();
  const [termId, setTermId] = useState("");
  const [cellKey, setCellKey] = useState("");
  const [name, setName] = useState("");
  const [maxScore, setMaxScore] = useState("20");
  const [weight, setWeight] = useState("1");
  const [heldOn, setHeldOn] = useState("");
  const term = termId || props.defaultTermId || props.terms[0]?.id || "";
  const cell = props.cells.find((c) => c.key === cellKey) ?? props.cells[0];

  if (props.terms.length === 0) {
    return (
      <p className="mt-6 rounded-lg bg-ground p-4 text-sm text-muted">
        The current year has no terms yet. Add them in Academic structure → Years &amp; terms.
      </p>
    );
  }
  if (props.cells.length === 0) {
    return <p className="mt-6 rounded-lg bg-ground p-4 text-sm text-muted">{props.noClassesHint}</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cell) return;
    props.onDone(null);
    try {
      const a = await create({
        termId: term,
        sectionId: cell.sectionId,
        subjectId: cell.subjectId,
        name: name.trim(),
        maxScore: Number(maxScore),
        weight: Number(weight),
        heldOn: heldOn || null,
      }).unwrap();
      props.onDone({ kind: "ok", text: `${a.name} added for ${a.section.label}, ${a.subject.name}.` });
      setName("");
      setHeldOn("");
    } catch (err) {
      props.onDone({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-ground p-4">
      <label className="block w-40 text-xs font-medium text-muted">
        Term
        <select value={term} onChange={(e) => setTermId(e.target.value)} className={selectClass}>
          {props.terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block w-64 text-xs font-medium text-muted">
        Class and subject
        <select value={cell?.key ?? ""} onChange={(e) => setCellKey(e.target.value)} className={selectClass}>
          {props.cells.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <Field label="Name" value={name} placeholder="Sequence 1" onChange={setName} width="w-40" />
      <Field label="Out of" type="number" value={maxScore} onChange={setMaxScore} width="w-20" />
      <Field label="Weight" type="number" value={weight} onChange={setWeight} width="w-20" />
      <Field label="Date (optional)" type="date" value={heldOn} onChange={setHeldOn} width="w-40" required={false} />
      <button type="submit" disabled={creating.isLoading} className={smallPrimaryButton}>
        {creating.isLoading ? "Saving…" : "Add assessment"}
      </button>
    </form>
  );
}

function EditRow(props: { assessment: Assessment; onClose: () => void; onDone: (message: Message) => void }) {
  const a = props.assessment;
  const [update, updating] = useUpdateAssessmentMutation();
  const [name, setName] = useState(a.name);
  const [maxScore, setMaxScore] = useState(String(a.maxScore));
  const [weight, setWeight] = useState(String(a.weight));
  const [heldOn, setHeldOn] = useState(a.heldOn ?? "");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onDone(null);
    try {
      await update({
        id: a.id,
        body: { name: name.trim(), maxScore: Number(maxScore), weight: Number(weight), heldOn: heldOn || null },
      }).unwrap();
      props.onDone({ kind: "ok", text: `${name.trim()} saved.` });
      props.onClose();
    } catch (err) {
      props.onDone({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  return (
    <tr className="border-b border-line bg-ground last:border-0">
      <td colSpan={8} className="px-4 py-3">
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <p className="w-full text-xs text-muted">
            {a.section.label} · {a.subject.name} · {a.term.name}
          </p>
          <Field label="Name" value={name} onChange={setName} width="w-40" />
          <Field label="Out of" type="number" value={maxScore} onChange={setMaxScore} width="w-20" />
          <Field label="Weight" type="number" value={weight} onChange={setWeight} width="w-20" />
          <Field label="Date (optional)" type="date" value={heldOn} onChange={setHeldOn} width="w-40" required={false} />
          <button type="submit" disabled={updating.isLoading} className={smallPrimaryButton}>
            {updating.isLoading ? "Saving…" : "Save"}
          </button>
          <button type="button" className={smallButton} onClick={props.onClose}>
            Cancel
          </button>
        </form>
      </td>
    </tr>
  );
}
