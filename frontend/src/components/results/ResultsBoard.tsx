"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import { useGetSectionsQuery, useGetYearsQuery } from "@/lib/api/academicApi";
import {
  useGetAnnualQuery,
  useGetPublicationsQuery,
  useGetSummaryQuery,
  useGetResultsQuery,
  usePublishResultsMutation,
  useUnpublishResultsMutation,
  type SectionResults,
} from "@/lib/api/resultsApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import AppHeader from "@/components/layout/AppHeader";
import { Badge, Notice, smallButton, smallPrimaryButton, type Message } from "@/components/academic/academicUi";

const selectClass =
  "mt-1 h-10 w-full rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

type View = "term" | "year" | "summary";

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Downloads the term results of the class shown as a CSV file (opens in Excel). */
function downloadCsv(r: SectionResults) {
  const subjects = r.results.students[0]?.subjects ?? [];
  const rows: (string | number | null)[][] = [
    ["Rank", "Matricule", "Student", ...subjects.map((s) => `${s.code} (x${s.coefficient})`), "Average", "Appreciation"],
    ...r.results.students.map((st) => [
      st.rank,
      st.student.matricule,
      st.student.fullName,
      ...st.subjects.map((l) => l.average),
      st.average,
      st.appreciation ?? "Not classified",
    ]),
    ["", "", "Class average", ...r.results.subjects.map((s) => s.classAverage), r.results.stats.classAverage, ""],
  ];
  const text = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  // The byte order mark lets Excel read the accents correctly.
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `results ${r.section.label} ${r.term.name} ${r.year.name}${r.provisional ? " (provisional)" : ""}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * /results — term results of a section (module "results", needs results.compute):
 * ranks, general averages, subject averages and class statistics. Only locked
 * assessments count, unless "Include assessments not yet locked" is ticked.
 */
export default function ResultsBoard() {
  const canView = useCan(PERMISSIONS.resultsCompute);
  const canPublish = useCan(PERMISSIONS.resultsPublish);
  const modules = useActiveModules();
  const active = modules.codes.has("results");
  const skip = !canView || !active;
  const years = useGetYearsQuery(undefined, { skip });
  const sections = useGetSectionsQuery(undefined, { skip });
  const year = years.data?.find((y) => y.isCurrent);
  const [termId, setTermId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [provisional, setProvisional] = useState(false);
  const [view, setView] = useState<View>("term");
  const term = termId || year?.terms.find((t) => t.isCurrent)?.id || year?.terms[0]?.id || "";
  const section = sectionId || sections.data?.[0]?.id || "";
  const results = useGetResultsQuery(
    { termId: term, sectionId: section, provisional },
    { skip: skip || !term || !section || view !== "term" },
  );
  const overview = useGetPublicationsQuery(term, { skip: skip || !term });
  const [message, setMessage] = useState<Message>(null);

  let blocked: string | null = null;
  if (!canView) blocked = "You do not have permission to see results.";
  else if (!modules.isLoading && !active) blocked = "The Results module is not active for your school.";

  const r = results.data;
  const subjects = r?.results.students[0]?.subjects ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Results</h1>
          {((view === "term" && r) || view === "summary") && (
            <div className="flex gap-2 print:hidden">
              {view === "term" && r && (
                <button type="button" className={smallButton} onClick={() => downloadCsv(r)}>
                  Download CSV
                </button>
              )}
              <button type="button" className={smallButton} onClick={() => window.print()}>
                Print
              </button>
            </div>
          )}
        </div>
        {blocked ? (
          <p role="alert" className="mt-4 rounded-lg bg-warn-bg p-4 text-sm text-warn">
            {blocked}
          </p>
        ) : modules.isLoading || years.isLoading || sections.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : !year || year.terms.length === 0 ? (
          <p className="mt-4 rounded-lg bg-ground p-4 text-sm text-muted">
            The current academic year has no terms yet. Set them up in Academic structure.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
              <label className="block w-48 text-xs font-medium text-muted">
                Show
                <select value={view} onChange={(e) => setView(e.target.value as View)} className={selectClass}>
                  <option value="term">One term</option>
                  <option value="year">The whole year</option>
                  <option value="summary">School summary</option>
                </select>
              </label>
              {view !== "year" && (
              <label className="block w-48 text-xs font-medium text-muted">
                Term
                <select value={term} onChange={(e) => setTermId(e.target.value)} className={selectClass}>
                  {year.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              )}
              {view !== "summary" && (
              <label className="block w-48 text-xs font-medium text-muted">
                Class
                <select value={section} onChange={(e) => setSectionId(e.target.value)} className={selectClass}>
                  {(sections.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              )}
              {view === "term" && (
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} />
                  Include assessments not yet locked (preview)
                </label>
              )}
            </div>

            {view === "year" && section && <AnnualView sectionId={section} />}
            {view === "summary" && <SummaryView termId={term} />}

            {view === "term" && overview.data && overview.data.sections.length > 0 && (
              <p className="mt-4 text-xs text-muted print:hidden">
                Published in {overview.data.term.name}:{" "}
                {overview.data.sections.filter((x) => x.publication).length} of {overview.data.sections.length} classes
                {overview.data.sections.some((x) => x.publication) &&
                  ` (${overview.data.sections
                    .filter((x) => x.publication)
                    .map((x) => x.label)
                    .join(", ")})`}
              </p>
            )}
            <Notice message={message} />
            {view === "term" && r && <PublicationBar results={r} canPublish={canPublish} onMessage={setMessage} />}

            {results.isFetching && !r && <p className="mt-6 text-sm text-muted">Computing…</p>}
            {results.error && (
              <p role="alert" className="mt-6 text-sm text-err">
                {apiErrorMessage(results.error)}
              </p>
            )}
            {view === "term" && r && (
              <>
                <p className="mt-6 text-sm">
                  <strong>
                    {r.section.label} · {r.term.name} {r.year.name}
                  </strong>
                  {r.provisional && <span className="ml-2 rounded bg-warn-bg px-2 py-0.5 text-xs text-warn">Provisional</span>}
                  <span className="text-muted">
                    {" "}
                    · {r.counted.length} assessment{r.counted.length === 1 ? "" : "s"} counted
                    {r.pending > 0 && `, ${r.pending} not counted yet`}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  Class average {fmt(r.results.stats.classAverage)} · highest {fmt(r.results.stats.highest)} · lowest{" "}
                  {fmt(r.results.stats.lowest)} · {r.results.stats.passed} of {r.results.stats.classified} at 10 or above
                  {r.results.stats.passRate !== null && ` (${r.results.stats.passRate}%)`}
                </p>

                {r.results.students.length === 0 ? (
                  <p className="mt-4 rounded-lg bg-ground p-4 text-sm text-muted">No student in this class.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Rank</th>
                          <th className="px-3 py-2 font-semibold">Student</th>
                          {subjects.map((s) => (
                            <th key={s.subjectId} className="px-2 py-2 text-right font-semibold" title={`${s.name}, coefficient ${s.coefficient}`}>
                              {s.code}
                              <span className="block font-normal normal-case">×{s.coefficient}</span>
                            </th>
                          ))}
                          <th className="px-3 py-2 text-right font-semibold">Average</th>
                          <th className="px-3 py-2 font-semibold">Appreciation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.results.students.map((st) => (
                          <tr key={st.student.studentId} className="border-b border-line last:border-0">
                            <td className="px-3 py-1.5 font-semibold">{st.rank ?? "—"}</td>
                            <td className="px-3 py-1.5">
                              {st.student.fullName}
                              <span className="ml-1 font-mono text-xs text-muted">{st.student.matricule}</span>
                            </td>
                            {st.subjects.map((l) => (
                              <td
                                key={l.subjectId}
                                className={`px-2 py-1.5 text-right font-mono ${l.average !== null && l.average < 10 ? "text-err" : ""}`}
                              >
                                {fmt(l.average)}
                              </td>
                            ))}
                            <td className={`px-3 py-1.5 text-right font-mono font-semibold ${st.passed ? "" : "text-err"}`}>{fmt(st.average)}</td>
                            <td className="px-3 py-1.5 text-xs">{st.appreciation ?? "Not classified"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-line bg-ground text-xs text-muted">
                        <tr>
                          <td className="px-3 py-2" colSpan={2}>
                            Class average per subject
                          </td>
                          {r.results.subjects.map((s) => (
                            <td key={s.subjectId} className="px-2 py-2 text-right font-mono">
                              {fmt(s.classAverage)}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-mono">{fmt(r.results.stats.classAverage)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** Publication state of the class shown, with Publish / Republish / Withdraw for holders of results.publish. */
function PublicationBar(props: { results: SectionResults; canPublish: boolean; onMessage: (m: Message) => void }) {
  const r = props.results;
  const [publish, publishing] = usePublishResultsMutation();
  const [unpublish, withdrawing] = useUnpublishResultsMutation();
  const p = r.publication;
  const changes = r.changesSincePublication;
  const target = { termId: r.term.id, sectionId: r.section.id };
  const busy = publishing.isLoading || withdrawing.isLoading;

  async function doPublish() {
    const again = p !== null;
    const question = again
      ? `Republish the results of ${r.section.label} for ${r.term.name}? Report cards will print the new results.`
      : `Publish the results of ${r.section.label} for ${r.term.name}? Report cards will print these results.`;
    if (!window.confirm(question)) return;
    props.onMessage(null);
    try {
      await publish(target).unwrap();
      props.onMessage({ kind: "ok", text: `Results of ${r.section.label} ${again ? "republished" : "published"}.` });
    } catch (err) {
      props.onMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  async function doWithdraw() {
    const reason = window.prompt(`Why are the results of ${r.section.label} being withdrawn? (kept in the audit log)`, "");
    if (reason === null) return;
    props.onMessage(null);
    try {
      await unpublish({ ...target, reason }).unwrap();
      props.onMessage({ kind: "ok", text: `Results of ${r.section.label} withdrawn. Report cards are provisional again.` });
    } catch (err) {
      props.onMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-white p-4 text-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {p ? (
            <>
              <strong>Published</strong> on {new Date(p.publishedAt).toLocaleString()} by {p.publishedBy || "—"}
              {p.version > 1 && ` (version ${p.version})`}. Report cards print these results.
            </>
          ) : (
            <>
              <strong>Not published.</strong> Report cards are provisional until the results are published.
            </>
          )}
        </p>
        {props.canPublish && (
          <div className="flex gap-2">
            {(!p || changes.length > 0) && (
              <button type="button" className={smallPrimaryButton} disabled={busy} onClick={() => void doPublish()}>
                {p ? "Republish" : "Publish results"}
              </button>
            )}
            {p && (
              <button type="button" className={smallButton} disabled={busy} onClick={() => void doWithdraw()}>
                Withdraw
              </button>
            )}
          </div>
        )}
      </div>
      {p && changes.length > 0 && (
        <div className="mt-3 rounded-lg bg-warn-bg p-3 text-warn">
          <p className="font-semibold">
            Marks changed after publishing. Republishing would change {changes.length} student
            {changes.length === 1 ? "" : "s"}:
          </p>
          <ul className="mt-1 space-y-0.5">
            {changes.map((c) => (
              <li key={c.studentId}>
                {c.fullName}: average {c.before?.average ?? "—"} → {c.after?.average ?? "—"}, rank {c.before?.rank ?? "—"} →{" "}
                {c.after?.rank ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Year results of a class: each term's average, the year average, rank and decision. */
function AnnualView({ sectionId }: { sectionId: string }) {
  const annual = useGetAnnualQuery(sectionId);
  const a = annual.data;
  if (annual.isLoading) return <p className="mt-6 text-sm text-muted">Computing…</p>;
  if (annual.error) {
    return (
      <p role="alert" className="mt-6 text-sm text-err">
        {apiErrorMessage(annual.error)}
      </p>
    );
  }
  if (!a) return null;
  return (
    <>
      <p className="mt-6 text-sm">
        <strong>
          {a.section.label} · {a.year.name}
        </strong>
        <span className="text-muted">
          {" "}
          ·{" "}
          {a.terms.length === 0
            ? "no term with locked marks yet"
            : a.terms.map((t) => `${t.name}${t.published ? " (published)" : " (not published)"}`).join(", ")}
        </span>
      </p>
      <p className="mt-1 text-sm text-muted">
        Class average {fmt(a.stats.classAverage)} · {a.stats.promoted} promoted · {a.stats.repeat} repeat
        {a.stats.size > a.stats.classified && ` · ${a.stats.size - a.stats.classified} not classified`}. The year average
        is the mean of the term averages; promotion at 10/20.
      </p>
      {a.students.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Rank</th>
                <th className="px-3 py-2 font-semibold">Student</th>
                {a.terms.map((t) => (
                  <th key={t.termId} className="px-2 py-2 text-right font-semibold">
                    {t.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Year</th>
                <th className="px-3 py-2 font-semibold">Decision</th>
              </tr>
            </thead>
            <tbody>
              {a.students.map((l) => (
                <tr key={l.student.studentId} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 font-semibold">{l.rank ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {l.student.fullName}
                    <span className="ml-1 font-mono text-xs text-muted">{l.student.matricule}</span>
                  </td>
                  {l.terms.map((t) => (
                    <td key={t.termId} className="px-2 py-1.5 text-right font-mono">
                      {fmt(t.average)}
                    </td>
                  ))}
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${l.decision === "repeat" ? "text-err" : ""}`}>
                    {fmt(l.average)}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {l.decision === "promoted" ? "Promoted" : l.decision === "repeat" ? "Repeats the class" : "Not classified"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const STATE_LABEL = {
  published: { text: "Published", tone: "ok" },
  final: { text: "Final, not published", tone: "brand" },
  in_progress: { text: "Marks in progress", tone: "muted" },
} as const;

/** The school's figures for a term: each class, each subject over every class, and the totals. */
function SummaryView({ termId }: { termId: string }) {
  const summary = useGetSummaryQuery(termId, { skip: !termId });
  const sm = summary.data;
  if (summary.isLoading) return <p className="mt-6 text-sm text-muted">Computing…</p>;
  if (summary.error) {
    return (
      <p role="alert" className="mt-6 text-sm text-err">
        {apiErrorMessage(summary.error)}
      </p>
    );
  }
  if (!sm) return null;
  if (sm.classes.length === 0) {
    return <p className="mt-6 rounded-lg bg-ground p-4 text-sm text-muted">No class has students for this term yet.</p>;
  }
  const t = sm.totals;
  return (
    <>
      <p className="mt-6 text-sm">
        <strong>{sm.term.name} · whole school</strong>
      </p>
      <p className="mt-1 text-sm text-muted">
        {t.classified} of {t.size} students classified · school average {fmt(t.average)} · {t.passed} at 10 or above (
        {pct(t.passRate)}). Published classes use their published copy; the others count only their locked assessments.
      </p>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-muted">Classes</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Class</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Students</th>
              <th className="px-3 py-2 text-right font-semibold">Classified</th>
              <th className="px-3 py-2 text-right font-semibold">Class average</th>
              <th className="px-3 py-2 text-right font-semibold">At 10 or above</th>
              <th className="px-3 py-2 text-right font-semibold">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {sm.classes.map((c) => (
              <tr key={c.sectionId} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5 font-medium">{c.label}</td>
                <td className="px-3 py-1.5">
                  <Badge tone={STATE_LABEL[c.state].tone}>{STATE_LABEL[c.state].text}</Badge>
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{c.size}</td>
                <td className="px-3 py-1.5 text-right font-mono">{c.classified}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${c.classAverage !== null && c.classAverage < 10 ? "text-err" : ""}`}>
                  {fmt(c.classAverage)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{c.passed}</td>
                <td className="px-3 py-1.5 text-right font-mono">{pct(c.passRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-muted">Subjects</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Subject</th>
              {sm.classes.map((c) => (
                <th key={c.sectionId} className="px-2 py-2 text-right font-semibold">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">School</th>
              <th className="px-3 py-2 text-right font-semibold">Marked</th>
              <th className="px-3 py-2 text-right font-semibold">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {sm.subjects.map((s) => (
              <tr key={s.subjectId} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5" title={s.name}>
                  <span className="font-mono text-xs text-muted">{s.code}</span> {s.name}
                </td>
                {sm.classes.map((c) => (
                  <td key={c.sectionId} className="px-2 py-1.5 text-right font-mono">
                    {c.sectionId in s.byClass ? fmt(s.byClass[c.sectionId]) : ""}
                  </td>
                ))}
                <td className={`px-3 py-1.5 text-right font-mono font-semibold ${s.average !== null && s.average < 10 ? "text-err" : ""}`}>
                  {fmt(s.average)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{s.graded}</td>
                <td className="px-3 py-1.5 text-right font-mono">{pct(s.passRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Class columns: the class average of the subject (blank when the class does not take it). School: the mean of every
        student&apos;s subject average. Pass rate: students at 10 or above in the subject.
      </p>
    </>
  );
}
