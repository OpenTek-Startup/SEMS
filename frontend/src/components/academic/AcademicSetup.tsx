"use client";

import { useState } from "react";
import { useGetCurrentPeriodQuery, useGetYearsQuery, type AcademicYear } from "@/lib/api/academicApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";
import ClassesPanel from "./ClassesPanel";
import SubjectsPanel from "./SubjectsPanel";
import TeachersPanel from "./TeachersPanel";
import YearsPanel from "./YearsPanel";
import { formatDay } from "./academicUi";

const TABS = [
  { id: "years", label: "Years & terms" },
  { id: "classes", label: "Classes & sections" },
  { id: "subjects", label: "Subjects" },
  { id: "teachers", label: "Teachers" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * /academic — the school's academic structure (module "academic").
 * Reading needs academic.structure.view; the forms and buttons appear only
 * with academic.structure.manage. The Teachers tab (needs the Staff module
 * too) lets academic.teacher.assign holders pick who teaches what.
 * The backend checks all of this anyway.
 */
export default function AcademicSetup() {
  const school = useAppSelector((state) => state.auth.user?.school);
  const canView = useCan(PERMISSIONS.academicView);
  const canManage = useCan(PERMISSIONS.academicManage);
  const canAssign = useCan(PERMISSIONS.teacherAssign);
  const modules = useActiveModules();
  const active = modules.codes.has("academic");
  const current = useGetCurrentPeriodQuery(undefined, { skip: !canView || !active });
  const years = useGetYearsQuery(undefined, { skip: !canView || !active });
  const currentYear = years.data?.find((y) => y.isCurrent);
  const [tab, setTab] = useState<TabId>("years");

  let blocked: string | null = null;
  if (!school) blocked = "The academic structure belongs to a school. Sign in to a school to see it.";
  else if (!canView) blocked = "You do not have permission to see the academic structure of this school.";
  else if (!modules.isLoading && !active) blocked = "The Academic module is not active for your school.";

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <p className="text-sm text-muted">Academics</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold">Academic structure</h1>
        {blocked ? (
          <p role="alert" className="mt-4 rounded-lg bg-warn-bg p-4 text-sm text-warn">
            {blocked}
          </p>
        ) : modules.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {current.data?.year ? (
                <>
                  Current year <strong className="text-ink">{current.data.year.name}</strong>
                  {current.data.term
                    ? ` · ${current.data.term.name} (until ${formatDay(current.data.term.endDate)})`
                    : " · between terms"}
                </>
              ) : (
                "No current academic year yet."
              )}
              {!canManage && " · read only"}
            </p>

            {currentYear && <YearOverview year={currentYear} />}

            <div role="tablist" aria-label="Academic structure" className="mt-6 flex gap-1 border-b border-line">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                    tab === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" className="mt-6">
              {tab === "years" && <YearsPanel canManage={canManage} />}
              {tab === "classes" && <ClassesPanel canManage={canManage} />}
              {tab === "subjects" && <SubjectsPanel canManage={canManage} />}
              {tab === "teachers" && <TeachersPanel canAssign={canAssign} staffActive={modules.codes.has("staff")} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** The grading scale used by the results (Cameroon: marks out of 20). */
const SCALE: [string, string][] = [
  ["18 – 20", "Excellent"],
  ["16 – 17.99", "Very good"],
  ["14 – 15.99", "Good"],
  ["12 – 13.99", "Fairly good"],
  ["10 – 11.99", "Average"],
  ["8 – 9.99", "Weak"],
  ["below 8", "Poor"],
];

/** The current year at a glance (mockup 06): its terms on a line, today marked, and the grading scale. */
function YearOverview({ year }: { year: AcademicYear }) {
  const start = new Date(year.startDate).getTime();
  const end = new Date(year.endDate).getTime();
  const span = Math.max(1, end - start);
  const today = new Date().getTime();
  const at = (value: string | number) => Math.min(100, Math.max(0, ((new Date(value).getTime() - start) / span) * 100));
  const terms = [...year.terms].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <section aria-labelledby="year-title" className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="year-title" className="text-lg font-semibold">
            Academic year {year.name}
          </h2>
          <span className="text-sm text-muted">
            {formatDay(year.startDate)} – {formatDay(year.endDate)}
          </span>
        </div>
        {terms.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No term yet. Add the terms in Years &amp; terms.</p>
        ) : (
          <>
            <div className="relative mt-5 h-9 rounded-lg bg-ground" aria-hidden="true">
              {terms.map((t) => (
                <div
                  key={t.id}
                  className={`absolute top-0 flex h-9 items-center justify-center overflow-hidden rounded-lg px-2 text-xs font-semibold ${
                    t.isCurrent ? "bg-brand text-white" : "bg-brand-tint text-brand"
                  }`}
                  style={{ left: `${at(t.startDate)}%`, width: `${Math.max(2, at(t.endDate) - at(t.startDate))}%` }}
                >
                  <span className="truncate">{t.name}</span>
                </div>
              ))}
              {today >= start && today <= end && (
                <div className="absolute -top-1.5 h-12 w-0.5 bg-err" style={{ left: `${at(today)}%` }} title="Today" />
              )}
            </div>
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              {terms.map((t) => (
                <li key={t.id} className={`rounded-lg border px-3 py-2 ${t.isCurrent ? "border-brand bg-brand-tint" : "border-line"}`}>
                  <span className="font-semibold">{t.name}</span>
                  {t.isCurrent && <span className="ml-2 text-xs font-semibold text-brand">now</span>}
                  <span className="block text-xs text-muted">
                    {formatDay(t.startDate)} – {formatDay(t.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby="scale-title" className="rounded-xl border border-line bg-white p-5">
        <h2 id="scale-title" className="text-lg font-semibold">
          Grading scale
        </h2>
        <p className="mt-0.5 text-xs text-muted">Marks out of 20 · pass mark 10</p>
        <dl className="mt-3 space-y-1 text-sm">
          {SCALE.map(([range, label]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="font-mono text-xs text-muted">{range}</dt>
              <dd className="font-medium">{label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
