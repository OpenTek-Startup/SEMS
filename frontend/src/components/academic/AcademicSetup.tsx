"use client";

import { useState } from "react";
import { useGetCurrentPeriodQuery } from "@/lib/api/academicApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "@/components/layout/AppHeader";
import ClassesPanel from "./ClassesPanel";
import SubjectsPanel from "./SubjectsPanel";
import YearsPanel from "./YearsPanel";
import { formatDay } from "./academicUi";

const TABS = [
  { id: "years", label: "Years & terms" },
  { id: "classes", label: "Classes & sections" },
  { id: "subjects", label: "Subjects" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * /academic — the school's academic structure (module "academic").
 * Reading needs academic.structure.view; the forms and buttons appear only
 * with academic.structure.manage. The backend checks both anyway.
 */
export default function AcademicSetup() {
  const school = useAppSelector((state) => state.auth.user?.school);
  const canView = useCan(PERMISSIONS.academicView);
  const canManage = useCan(PERMISSIONS.academicManage);
  const modules = useActiveModules();
  const active = modules.codes.has("academic");
  const current = useGetCurrentPeriodQuery(undefined, { skip: !canView || !active });
  const [tab, setTab] = useState<TabId>("years");

  let blocked: string | null = null;
  if (!school) blocked = "The academic structure belongs to a school. Sign in to a school to see it.";
  else if (!canView) blocked = "You do not have permission to see the academic structure of this school.";
  else if (!modules.isLoading && !active) blocked = "The Academic module is not active for your school.";

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-semibold">Academic structure</h1>
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
            </div>
          </>
        )}
      </main>
    </div>
  );
}
