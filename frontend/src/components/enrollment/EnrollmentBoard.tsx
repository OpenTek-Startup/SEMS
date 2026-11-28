"use client";

import { useMemo, useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useEnrollMutation,
  useGetEnrollmentsQuery,
  useGetSectionOverviewQuery,
  useTransferMutation,
  useWithdrawMutation,
  type Enrollment,
  type SectionCount,
} from "@/lib/api/enrollmentApi";
import { useGetStudentsQuery } from "@/lib/api/studentsApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { Badge, Notice, smallButton, smallPrimaryButton, dangerButton, type Message } from "@/components/academic/academicUi";

const selectClass =
  "h-9 rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/**
 * /enrollment ("Classes") — who is in which section this year (module "enrollment").
 * Pick a section to see its class list, add students who have no class yet,
 * move a student to another section, or record that they left.
 */
export default function EnrollmentBoard() {
  const canView = useCan(PERMISSIONS.studentView);
  const canEnroll = useCan(PERMISSIONS.enroll);
  const canWithdraw = useCan(PERMISSIONS.withdraw);
  const modules = useActiveModules();
  const active = modules.codes.has("enrollment") && modules.codes.has("student");
  const skip = !canView || !active;

  const overview = useGetSectionOverviewQuery(undefined, { skip });
  const [picked, setPicked] = useState<string | null>(null);
  const sections = overview.data?.sections ?? [];
  const section: SectionCount | undefined = sections.find((s) => s.sectionId === picked) ?? sections[0];
  const [message, setMessage] = useState<Message>(null);

  let blocked: string | null = null;
  if (!canView) blocked = "You do not have permission to see the classes of this school.";
  else if (!modules.isLoading && !active) blocked = "The Enrollment module is not active for your school.";

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <p className="text-sm text-muted">People</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold">Classes &amp; enrollment</h1>
        {blocked ? (
          <p role="alert" className="mt-4 rounded-lg bg-warn-bg p-4 text-sm text-warn">
            {blocked}
          </p>
        ) : modules.isLoading || overview.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : overview.error ? (
          <p role="alert" className="mt-4 text-sm text-err">
            {apiErrorMessage(overview.error)}
          </p>
        ) : !overview.data?.year ? (
          <p className="mt-4 rounded-lg bg-ground p-4 text-sm text-muted">
            There is no current academic year. Set one up in Academic structure first.
          </p>
        ) : sections.length === 0 || !section ? (
          <p className="mt-4 rounded-lg bg-ground p-4 text-sm text-muted">
            No section yet. Add classes and sections in Academic structure first.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {overview.data.year.name} · {sections.reduce((n, s) => n + s.enrolled, 0)} students in {sections.length}{" "}
              sections
            </p>
            <Notice message={message} />
            <div className="mt-6 grid gap-4 md:grid-cols-[15rem_1fr]">
              <nav aria-label="Sections" className="rounded-xl border border-line bg-white p-2">
                <ul>
                  {sections.map((s) => (
                    <li key={s.sectionId}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(s.sectionId);
                          setMessage(null);
                        }}
                        aria-current={s.sectionId === section.sectionId}
                        className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                          s.sectionId === section.sectionId ? "bg-brand-tint font-semibold text-brand" : "hover:bg-ground"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span>{s.label}</span>
                          <Badge tone={s.capacity !== null && s.enrolled >= s.capacity ? "ok" : "muted"}>
                            {s.enrolled}
                            {s.capacity !== null ? `/${s.capacity}` : ""}
                          </Badge>
                        </span>
                        {s.capacity !== null && s.capacity > 0 && (
                          <span className="mt-1.5 block h-1.5 rounded bg-ground" aria-hidden="true">
                            <span
                              className={`block h-1.5 rounded ${s.enrolled >= s.capacity ? "bg-ok" : "bg-brand"}`}
                              style={{ width: `${Math.min(100, (s.enrolled / s.capacity) * 100)}%` }}
                            />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <SectionPanel
                key={section.sectionId}
                section={section}
                sections={sections}
                canEnroll={canEnroll}
                canWithdraw={canWithdraw}
                onMessage={setMessage}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SectionPanel(props: {
  section: SectionCount;
  sections: SectionCount[];
  canEnroll: boolean;
  canWithdraw: boolean;
  onMessage: (m: Message) => void;
}) {
  const { section } = props;
  const list = useGetEnrollmentsQuery({ sectionId: section.sectionId });
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [transfer, transferring] = useTransferMutation();
  const [withdraw, withdrawing] = useWithdrawMutation();
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});

  const current = (list.data ?? []).filter((e) => e.status === "active");
  const closed = (list.data ?? []).filter((e) => e.status !== "active");
  const others = props.sections.filter((s) => s.sectionId !== section.sectionId);

  async function move(e: Enrollment) {
    const target = moveTo[e.id] ?? others[0]?.sectionId;
    if (!target) return;
    const label = others.find((s) => s.sectionId === target)?.label;
    props.onMessage(null);
    try {
      await transfer({ id: e.id, sectionId: target }).unwrap();
      props.onMessage({ kind: "ok", text: `${e.student.fullName} moved to ${label}.` });
    } catch (err) {
      props.onMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  async function leave(e: Enrollment) {
    const reason = window.prompt(`${e.student.fullName} leaves ${section.label}. Reason (optional):`, "");
    if (reason === null) return;
    props.onMessage(null);
    try {
      await withdraw({ id: e.id, reason: reason.trim() || undefined }).unwrap();
      props.onMessage({ kind: "ok", text: `${e.student.fullName} withdrawn from ${section.label}.` });
    } catch (err) {
      props.onMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{section.label}</h2>
          <p className="text-xs text-muted">
            {section.enrolled} student{section.enrolled === 1 ? "" : "s"} · {section.girls} girls, {section.boys} boys
            {section.capacity !== null && ` · ${Math.max(0, section.capacity - section.enrolled)} free places`}
          </p>
        </div>
        {props.canEnroll && (
          <button type="button" className={adding ? smallButton : smallPrimaryButton} onClick={() => setAdding(!adding)}>
            {adding ? "Close" : "Add students"}
          </button>
        )}
      </div>

      {adding && <AddStudents section={section} onMessage={props.onMessage} onDone={() => setAdding(false)} />}

      {list.isLoading && <p className="p-4 text-sm text-muted">Loading the class list…</p>}
      {list.error && (
        <p role="alert" className="p-4 text-sm text-err">
          {apiErrorMessage(list.error)}
        </p>
      )}
      {list.data && current.length === 0 && <p className="p-4 text-sm text-muted">No student in this section yet.</p>}
      {current.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">#</th>
              <th className="px-4 py-2 font-semibold">Name</th>
              <th className="px-4 py-2 font-semibold">Matricule</th>
              <th className="px-4 py-2 font-semibold">Since</th>
              <th className="px-4 py-2 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {current.map((e, i) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2 text-muted">{i + 1}</td>
                <td className="px-4 py-2">
                  {e.student.fullName} <span className="text-xs text-muted">{e.student.gender === "female" ? "F" : "M"}</span>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{e.student.matricule}</td>
                <td className="px-4 py-2 text-xs text-muted">{e.enrolledOn}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    {props.canEnroll && others.length > 0 && (
                      <>
                        <select
                          aria-label={`Move ${e.student.fullName} to`}
                          value={moveTo[e.id] ?? others[0].sectionId}
                          onChange={(ev) => setMoveTo({ ...moveTo, [e.id]: ev.target.value })}
                          className={selectClass}
                        >
                          {others.map((s) => (
                            <option key={s.sectionId} value={s.sectionId}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <button type="button" className={smallButton} disabled={transferring.isLoading} onClick={() => void move(e)}>
                          Move
                        </button>
                      </>
                    )}
                    {props.canWithdraw && (
                      <button type="button" className={dangerButton} disabled={withdrawing.isLoading} onClick={() => void leave(e)}>
                        Withdraw
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {closed.length > 0 && (
        <div className="border-t border-line px-4 py-3 text-sm">
          <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Hide" : "Show"} {closed.length} student{closed.length === 1 ? "" : "s"} who left this section
          </button>
          {showClosed && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {closed.map((e) => (
                <li key={e.id}>
                  {e.student.fullName} · {e.status} on {e.leftOn}
                  {e.reason ? ` · ${e.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Students with no class this year, ticked and added to the section in one go. */
function AddStudents(props: { section: SectionCount; onMessage: (m: Message) => void; onDone: () => void }) {
  const unplaced = useGetStudentsQuery({ unplaced: true });
  const [enroll, enrolling] = useEnrollMutation();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (unplaced.data ?? []).filter((s) => words.every((w) => `${s.fullName} ${s.matricule}`.toLowerCase().includes(w)));
  }, [unplaced.data, search]);

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  }

  async function add() {
    props.onMessage(null);
    try {
      const added = await enroll({ sectionId: props.section.sectionId, studentIds: [...chosen] }).unwrap();
      props.onMessage({ kind: "ok", text: `${added.length} student${added.length === 1 ? "" : "s"} added to ${props.section.label}.` });
      setChosen(new Set());
      props.onDone();
    } catch (err) {
      props.onMessage({ kind: "error", text: apiErrorMessage(err) });
    }
  }

  return (
    <div className="border-b border-line bg-ground p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a student without a class…"
          aria-label="Find a student"
          className="h-9 min-w-56 flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand"
        />
        <button type="button" className={smallButton} onClick={() => setChosen(new Set(shown.map((s) => s.id)))} disabled={shown.length === 0}>
          Tick all shown
        </button>
        <button type="button" className={smallPrimaryButton} disabled={chosen.size === 0 || enrolling.isLoading} onClick={() => void add()}>
          {enrolling.isLoading ? "Adding…" : `Add ${chosen.size || ""} to ${props.section.label}`}
        </button>
      </div>
      {unplaced.isLoading && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {unplaced.data && unplaced.data.length === 0 && (
        <p className="mt-3 text-sm text-muted">Every active student already has a class this year. Add new students on the Students page.</p>
      )}
      {shown.length > 0 && (
        <ul className="mt-3 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
          {shown.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-white">
                <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
                <span>{s.fullName}</span>
                <span className="font-mono text-xs text-muted">{s.matricule}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
