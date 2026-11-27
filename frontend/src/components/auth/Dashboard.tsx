"use client";

import Link from "next/link";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "@/components/layout/AppHeader";
import { useGetAuditQuery, type AuditItem } from "@/lib/api/auditApi";
import { useGetDashboardQuery, type DashboardView, type StatusCounts } from "@/lib/api/dashboardApi";
import { useGetMyTeachingQuery } from "@/lib/api/teachingApi";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";

const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

/**
 * Home page after sign-in (mockup 04). For a school user: key figures,
 * assessment progress by class, the user's classes and recent activity,
 * each shown only when the module is active and the user may see it.
 * For the platform Super Admin: a short welcome and the way to the console.
 */
export default function Dashboard() {
  const user = useAppSelector((state) => state.auth.user);
  const school = user?.school ?? null;
  const modules = useActiveModules();
  const dashboard = useGetDashboardQuery(undefined, { skip: !school });
  const canAudit = can(user, PERMISSIONS.auditView);
  const activity = useGetAuditQuery({ pageSize: 6 }, { skip: !school || !canAudit });
  const teachingOn = modules.codes.has("academic") && modules.codes.has("staff");
  const mine = useGetMyTeachingQuery(undefined, { skip: !school || !teachingOn || !can(user, PERMISSIONS.academicView) });
  if (!user) return null;

  const now = new Date();
  const d = dashboard.data;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <p className="text-sm text-muted">
          {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {d?.year && ` · ${d.year.name}`}
          {d?.term && ` · ${d.term.name}${d.term.current ? "" : " (ended)"}`}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            {greeting(now.getHours())}, {user.firstName}
          </h1>
          {school && <QuickActions />}
        </div>

        {!school && (
          <section className="mt-6 rounded-xl border border-line bg-white p-5">
            <p>You are signed in to the YESE platform as Super Admin.</p>
            <Link href="/platform" className="mt-2 inline-block text-sm text-brand hover:underline">
              Open the platform console (schools and modules)
            </Link>
          </section>
        )}

        {school && dashboard.isLoading && <p className="mt-6 text-sm text-muted">Loading the figures…</p>}
        {school && d && (
          <>
            <Tiles d={d} />
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
              <div className="space-y-4">
                {d.assessments && d.term && <Progress d={d} />}
                {!d.year && can(user, PERMISSIONS.academicView) && (
                  <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
                    No current academic year yet.{" "}
                    <Link href="/academic" className="text-brand hover:underline">
                      Set one up in Academic structure
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div className="space-y-4">
                {mine.data?.staff && (
                  <section className="rounded-xl border border-line bg-white p-5">
                    <h2 className="text-sm font-semibold">My classes</h2>
                    {mine.data.classes.length === 0 ? (
                      <p className="mt-2 text-sm text-muted">No class assigned this year.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm">
                        {mine.data.classes.map((c) => (
                          <li key={`${c.sectionId}-${c.subjectId}`}>
                            {c.label} · {c.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
                {canAudit && (
                  <section className="rounded-xl border border-line bg-white p-5">
                    <h2 className="text-sm font-semibold">Recent activity</h2>
                    {activity.data && activity.data.items.length === 0 && (
                      <p className="mt-2 text-sm text-muted">Nothing yet.</p>
                    )}
                    <ul className="mt-2 space-y-3">
                      {(activity.data?.items ?? []).map((item) => (
                        <li key={item.id} className="text-sm">
                          <p>{describe(item)}</p>
                          <p className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p>
                        </li>
                      ))}
                    </ul>
                    <Link href="/audit" className="mt-3 inline-block text-sm text-brand hover:underline">
                      Full audit log
                    </Link>
                  </section>
                )}
              </div>
            </div>
          </>
        )}

        <p className="mt-8 text-xs text-muted">
          {user.email}
          {school && ` · ${school.name}`} ·{" "}
          <Link href="/change-password" className="text-brand hover:underline">
            Change password
          </Link>{" "}
          · You are signed out after 15 minutes without activity.
        </p>
      </main>
    </div>
  );
}

/** Buttons for the most common jobs, only those the user can do. */
function QuickActions() {
  const user = useAppSelector((state) => state.auth.user);
  const modules = useActiveModules();
  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/enrollment", label: "Enroll students", show: modules.codes.has("enrollment") && can(user, PERMISSIONS.enroll) },
    { href: "/assessment", label: "Marks", show: modules.codes.has("assessment") && can(user, PERMISSIONS.marksEnter) },
    { href: "/results", label: "Results", show: modules.codes.has("results") && can(user, PERMISSIONS.resultsCompute) },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {links
        .filter((l) => l.show)
        .map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-ground"
          >
            {l.label}
          </Link>
        ))}
    </div>
  );
}

function Tile(props: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted">{props.label}</p>
      <p className="mt-1 text-2xl font-semibold">{props.value}</p>
      {props.note && <p className="mt-0.5 text-xs text-muted">{props.note}</p>}
    </>
  );
  const box = "block rounded-xl border border-line bg-white p-4";
  return props.href ? (
    <Link href={props.href} className={`${box} hover:border-brand`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function Tiles({ d }: { d: DashboardView }) {
  const tiles = [];
  if (d.students) {
    tiles.push(
      <Tile
        key="students"
        label="Students enrolled"
        value={String(d.students.enrolled)}
        note={`${d.students.girls} girls, ${d.students.boys} boys${d.students.withoutClass ? ` · ${d.students.withoutClass} without a class` : ""}`}
        href="/enrollment"
      />,
    );
  }
  if (d.staff) {
    tiles.push(<Tile key="staff" label="Staff" value={String(d.staff.active)} note={`${d.staff.teaching} teaching`} href="/staff" />);
  }
  if (d.teaching) {
    tiles.push(
      <Tile
        key="teaching"
        label="Subjects with a teacher"
        value={`${d.teaching.assigned} / ${d.teaching.places}`}
        note="section × subject places this year"
        href="/academic"
      />,
    );
  }
  if (d.assessments && d.term) {
    const o = d.assessments.overall;
    tiles.push(
      <Tile
        key="assessments"
        label={d.assessments.scope === "mine" ? `My assessments, ${d.term.name}` : `Assessments locked, ${d.term.name}`}
        value={d.assessments.scope === "mine" ? String(o.total) : `${o.locked} / ${o.total}`}
        note={d.assessments.scope === "mine" ? `${o.open} open, ${o.submitted} submitted` : `${o.submitted} waiting for validation`}
        href="/assessment"
      />,
    );
  }
  if (d.results && d.term) {
    tiles.push(
      <Tile
        key="results"
        label={`Results published, ${d.term.name}`}
        value={`${d.results.published} / ${d.results.sections}`}
        note="classes"
        href="/results"
      />,
    );
  }
  if (tiles.length === 0) return null;
  return <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{tiles}</div>;
}

const SEGMENTS: { key: keyof Omit<StatusCounts, "total">; label: string; className: string }[] = [
  { key: "locked", label: "Locked", className: "bg-brand" },
  { key: "validated", label: "Validated", className: "bg-brand/60" },
  { key: "submitted", label: "Submitted", className: "bg-brand/30" },
  { key: "open", label: "Open", className: "bg-line" },
];

/** One bar per class: how far its assessments of the term have gone. */
function Progress({ d }: { d: DashboardView }) {
  const a = d.assessments!;
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {a.scope === "mine" ? "My assessments" : "Assessments"} of {d.term!.name}, by class
        </h2>
        <Link href="/assessment" className="text-sm text-brand hover:underline">
          Open assessments
        </Link>
      </div>
      {a.byClass.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No assessment created for this term yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="py-2 font-semibold">Class</th>
              <th className="py-2 font-semibold">Progress</th>
              <th className="py-2 text-right font-semibold">Locked</th>
            </tr>
          </thead>
          <tbody>
            {a.byClass.map((c) => (
              <tr key={c.classId} className="border-t border-line">
                <td className="w-28 py-2 font-medium">{c.name}</td>
                <td className="py-2 pr-4">
                  <div
                    className="flex h-2.5 overflow-hidden rounded-full bg-ground"
                    role="img"
                    aria-label={`${c.locked} locked, ${c.validated} validated, ${c.submitted} submitted, ${c.open} open`}
                  >
                    {SEGMENTS.map((s) =>
                      c[s.key] ? <div key={s.key} className={s.className} style={{ width: `${(c[s.key] / c.total) * 100}%` }} /> : null,
                    )}
                  </div>
                </td>
                <td className="w-20 py-2 text-right font-mono">
                  {c.locked} / {c.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.className}`} /> {s.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A readable line for the most common audit entries; the action code otherwise. */
function describe(item: AuditItem): string {
  const who = item.actor?.name ?? "Someone";
  const d = (item.detail ?? {}) as Record<string, string | number | null | undefined>;
  const what = `${d.subject ?? ""} ${d.name ? `(${d.name})` : ""}`.trim();
  switch (item.action) {
    case "assessment.created":
      return `${who} created ${what} for ${d.section}.`;
    case "assessment.marks.saved":
      return `${who} entered ${d.changed} mark${d.changed === 1 ? "" : "s"}: ${what}, ${d.section}.`;
    case "assessment.submitted":
      return `${who} submitted ${what} marks for ${d.section}.`;
    case "assessment.validated":
      return `${who} validated ${what} marks for ${d.section}.`;
    case "assessment.locked":
      return `${who} locked ${what} marks for ${d.section}.`;
    case "assessment.reopened":
      return `${who} sent ${what} for ${d.section} back to the teacher.`;
    case "assessment.mark.overridden":
      return `${who} changed a locked mark of ${d.student ?? "a student"} (${d.subject}, ${d.section}).`;
    case "enrollment.created":
      return `${who} enrolled ${d.student} in ${d.section}.`;
    case "enrollment.transferred":
      return `${who} moved ${d.student} from ${d.from} to ${d.to}.`;
    case "enrollment.withdrawn":
      return `${who} withdrew ${d.student} from ${d.section}.`;
    case "student.created":
      return `${who} added the student ${d.name}.`;
    case "results.published":
    case "results.republished":
      return `${who} published the results of ${d.section} (${d.term}).`;
    case "results.unpublished":
      return `${who} withdrew the results of ${d.section} (${d.term}).`;
    default:
      return `${who}: ${item.action.replace(/[._]/g, " ")}`;
  }
}
