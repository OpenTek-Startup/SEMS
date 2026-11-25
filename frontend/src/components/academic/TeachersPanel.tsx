"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import { useGetYearsQuery } from "@/lib/api/academicApi";
import {
  useGetAssignmentsQuery,
  useGetMyTeachingQuery,
  useGetTeachersQuery,
  useSetAssignmentMutation,
  type AssignmentCell,
  type SectionAssignments,
  type TeacherOption,
} from "@/lib/api/teachingApi";
import { Badge, Notice, type Message } from "./academicUi";

const selectClass =
  "h-9 w-full rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

/**
 * Teachers tab: who teaches each subject in each section, per academic year.
 * With academic.teacher.assign every cell is a picker; otherwise read only.
 * Needs the Staff module as well as the Academic module.
 */
export default function TeachersPanel({ canAssign, staffActive }: { canAssign: boolean; staffActive: boolean }) {
  const years = useGetYearsQuery(undefined, { skip: !staffActive });
  // "" = the current year (the backend's default)
  const [yearId, setYearId] = useState("");
  const grid = useGetAssignmentsQuery(yearId || undefined, { skip: !staffActive });
  const teachers = useGetTeachersQuery(yearId || undefined, { skip: !staffActive || !canAssign });
  const mine = useGetMyTeachingQuery(undefined, { skip: !staffActive });
  const [setAssignment, saving] = useSetAssignmentMutation();
  const [message, setMessage] = useState<Message>(null);
  const [picked, setPicked] = useState<string | null>(null);

  if (!staffActive) {
    return (
      <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-warn">
        Teacher assignment needs the Staff module. Ask OpenTek to switch it on for your school.
      </p>
    );
  }

  const sections = grid.data?.sections ?? [];
  const section: SectionAssignments | undefined = sections.find((s) => s.sectionId === picked) ?? sections[0];

  async function change(cell: AssignmentCell, staffMemberId: string) {
    if (!section || !grid.data?.year) return;
    setMessage(null);
    try {
      await setAssignment({
        yearId: grid.data.year.id,
        sectionId: section.sectionId,
        subjectId: cell.subjectId,
        staffMemberId: staffMemberId || null,
      }).unwrap();
      const who = teachers.data?.find((t) => t.id === staffMemberId)?.fullName;
      setMessage({
        kind: "ok",
        text: who ? `${who} now teaches ${cell.name} in ${section.label}.` : `${cell.name} in ${section.label} has no teacher now.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  return (
    <section>
      {mine.data?.staff && (
        <div className="mb-6 rounded-xl border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">My classes{mine.data.year ? ` in ${mine.data.year.name}` : ""}</h2>
          {mine.data.classes.length === 0 ? (
            <p className="mt-1 text-sm text-muted">You have no class assigned yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {mine.data.classes.map((c) => (
                <li key={`${c.sectionId}-${c.subjectId}`} className="rounded-lg bg-ground px-3 py-1 text-sm">
                  {c.label} · {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          One teacher per subject in each section. Only active teaching staff can be chosen; add them in Staff first.
        </p>
        <label className="block w-48 text-xs font-medium text-muted">
          Academic year
          <select value={yearId} onChange={(e) => setYearId(e.target.value)} className={`mt-1 ${selectClass}`}>
            <option value="">Current year</option>
            {(years.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Notice message={message} />

      {grid.isLoading && <p className="mt-6 text-sm text-muted">Loading assignments…</p>}
      {grid.error && (
        <p role="alert" className="mt-6 text-sm text-err">
          {apiErrorMessage(grid.error)}
        </p>
      )}
      {grid.data && !grid.data.year && (
        <p className="mt-6 rounded-lg bg-ground p-4 text-sm text-muted">
          There is no current academic year. Create one in the Years &amp; terms tab, or choose a year above.
        </p>
      )}
      {grid.data?.year && sections.length === 0 && (
        <p className="mt-6 rounded-lg bg-ground p-4 text-sm text-muted">
          No section yet. Add classes and sections in the Classes tab first.
        </p>
      )}

      {grid.data?.year && section && (
        <>
          <p className="mt-6 text-sm">
            <strong>{grid.data.assigned}</strong> of {grid.data.total} subject places have a teacher in{" "}
            {grid.data.year.name}.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-[14rem_1fr]">
            <nav aria-label="Sections" className="rounded-xl border border-line bg-white p-2">
              <ul>
                {sections.map((s) => {
                  const full = s.cells.length > 0 && s.assigned === s.cells.length;
                  return (
                    <li key={s.sectionId}>
                      <button
                        type="button"
                        onClick={() => setPicked(s.sectionId)}
                        aria-current={s.sectionId === section.sectionId}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                          s.sectionId === section.sectionId ? "bg-brand-tint font-semibold text-brand" : "hover:bg-ground"
                        }`}
                      >
                        <span>{s.label}</span>
                        <Badge tone={full ? "ok" : "muted"}>
                          {s.assigned}/{s.cells.length}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{section.label}</h2>
              {section.cells.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  This class has no subject yet. Choose its subjects in the Classes tab.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Subject</th>
                      <th className="px-4 py-3 font-semibold">Coef.</th>
                      <th className="px-4 py-3 font-semibold">Teacher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.cells.map((cell) => (
                      <tr key={cell.subjectId} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs text-muted">{cell.code}</span> {cell.name}
                        </td>
                        <td className="px-4 py-2">{cell.coefficient}</td>
                        <td className="px-4 py-2">
                          {canAssign ? (
                            <TeacherPicker
                              cell={cell}
                              options={teachers.data ?? []}
                              disabled={saving.isLoading || teachers.isLoading}
                              onChange={(id) => change(cell, id)}
                            />
                          ) : cell.teacher ? (
                            <TeacherName cell={cell} />
                          ) : (
                            <span className="text-muted">Not assigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {canAssign && teachers.data && teachers.data.length > 0 && (
            <div className="mt-6 rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold">Teaching load in {grid.data.year.name}</h2>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {teachers.data.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 rounded-lg px-2 py-1 hover:bg-ground">
                    <span>
                      {t.fullName} <span className="text-muted">· {t.position}</span>
                    </span>
                    <span className="text-muted">{t.load === 1 ? "1 class" : `${t.load} classes`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TeacherName({ cell }: { cell: AssignmentCell }) {
  if (!cell.teacher) return null;
  return (
    <span>
      {cell.teacher.fullName} {!cell.teacher.active && <Badge tone="muted">has left</Badge>}
    </span>
  );
}

/** A select of active teaching staff; a teacher who has left stays shown until replaced. */
function TeacherPicker(props: {
  cell: AssignmentCell;
  options: TeacherOption[];
  disabled: boolean;
  onChange: (staffMemberId: string) => void;
}) {
  const { cell, options } = props;
  const current = cell.teacher;
  const listed = current && options.some((o) => o.id === current.id);
  return (
    <select
      aria-label={`Teacher of ${cell.name}`}
      value={current?.id ?? ""}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      className={selectClass}
    >
      <option value="">Not assigned</option>
      {current && !listed && (
        <option value={current.id} disabled>
          {current.fullName} (has left)
        </option>
      )}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.fullName} · {o.position}
        </option>
      ))}
    </select>
  );
}
