"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import { useGetSectionsQuery, useGetYearsQuery } from "@/lib/api/academicApi";
import { useGetResultsQuery } from "@/lib/api/resultsApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import AppHeader from "@/components/layout/AppHeader";
import { smallButton } from "@/components/academic/academicUi";

const selectClass =
  "mt-1 h-10 w-full rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(2));

/**
 * /results — term results of a section (module "results", needs results.compute):
 * ranks, general averages, subject averages and class statistics. Only locked
 * assessments count, unless "Include assessments not yet locked" is ticked.
 */
export default function ResultsBoard() {
  const canView = useCan(PERMISSIONS.resultsCompute);
  const modules = useActiveModules();
  const active = modules.codes.has("results");
  const skip = !canView || !active;
  const years = useGetYearsQuery(undefined, { skip });
  const sections = useGetSectionsQuery(undefined, { skip });
  const year = years.data?.find((y) => y.isCurrent);
  const [termId, setTermId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [provisional, setProvisional] = useState(false);
  const term = termId || year?.terms.find((t) => t.isCurrent)?.id || year?.terms[0]?.id || "";
  const section = sectionId || sections.data?.[0]?.id || "";
  const results = useGetResultsQuery({ termId: term, sectionId: section, provisional }, { skip: skip || !term || !section });

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
          {r && (
            <button type="button" className={`${smallButton} print:hidden`} onClick={() => window.print()}>
              Print
            </button>
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
                Term
                <select value={term} onChange={(e) => setTermId(e.target.value)} className={selectClass}>
                  {year.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
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
              <label className="flex h-10 items-center gap-2 text-sm">
                <input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} />
                Include assessments not yet locked (preview)
              </label>
            </div>

            {results.isFetching && !r && <p className="mt-6 text-sm text-muted">Computing…</p>}
            {results.error && (
              <p role="alert" className="mt-6 text-sm text-err">
                {apiErrorMessage(results.error)}
              </p>
            )}
            {r && (
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
