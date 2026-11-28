"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useLogoutMutation } from "@/lib/api/authApi";
import { useGetDashboardQuery } from "@/lib/api/dashboardApi";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";

type NavItem = {
  href: string;
  label: string;
  /** null: any signed-in school user; "superAdmin": the platform Super Admin only */
  permission: string | null | "superAdmin";
  /** shown only while this module is active for the school */
  module?: string;
};

/** The side menu, grouped as in the mockups. Empty groups are hidden. */
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", permission: null }] },
  {
    label: "People",
    items: [
      { href: "/students", label: "Students & guardians", permission: PERMISSIONS.studentView, module: "student" },
      { href: "/staff", label: "Staff", permission: PERMISSIONS.staffView, module: "staff" },
      { href: "/enrollment", label: "Classes", permission: PERMISSIONS.studentView, module: "enrollment" },
    ],
  },
  {
    label: "Academics",
    items: [
      { href: "/academic", label: "Academic structure", permission: PERMISSIONS.academicView, module: "academic" },
      { href: "/assessment", label: "Assessments & marks", permission: PERMISSIONS.academicView, module: "assessment" },
      { href: "/results", label: "Results", permission: PERMISSIONS.resultsCompute, module: "results" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/users", label: "Users & roles", permission: PERMISSIONS.userView },
      { href: "/audit", label: "Audit log", permission: PERMISSIONS.auditView },
    ],
  },
  { label: "Platform", items: [{ href: "/platform", label: "Schools & modules", permission: "superAdmin" }] },
];

/** "Northfield Bilingual College" -> "NBC" (at most 3 letters). */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w));
  return (words.length > 1 ? words.map((w) => w[0]) : [name.slice(0, 2)]).join("").slice(0, 3).toUpperCase();
}

/**
 * The frame of every signed-in page (mockups 04 to 11): the side menu on the
 * left, the top bar with the current term and the user, then the page.
 * Menu entries the user has no permission for, or whose module is off, are
 * hidden (the backend refuses them anyway). On a phone the menu slides in.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useAppSelector((state) => state.auth.user);
  const [logout, { isLoading: signingOut }] = useLogoutMutation();
  const activeModules = useActiveModules().codes;
  const [menuOpen, setMenuOpen] = useState(false);
  const dashboard = useGetDashboardQuery(undefined, { skip: !user?.school });

  // The password page stands alone: nothing else is reachable until the password is changed.
  if (!user || user.mustChangePassword || pathname === "/change-password") return <>{children}</>;

  const groups = GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => {
      if (item.module && !activeModules.has(item.module)) return false;
      if (item.permission === null) return !user.isSuperAdmin || Boolean(user.school);
      if (item.permission === "superAdmin") return user.isSuperAdmin;
      return can(user, item.permission);
    }),
  })).filter((g) => g.items.length > 0);

  const schoolName = user.school?.name ?? "YESE platform";
  const roleNames = user.isSuperAdmin && !user.school ? "Super Admin" : user.roles.map((r) => r.name).join(", ") || "No role yet";
  const fullName = `${user.firstName} ${user.lastName}`;
  const period = dashboard.data?.year
    ? [dashboard.data.year.name, dashboard.data.term?.name].filter(Boolean).join(" · ")
    : null;

  const menu = (
    <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto px-3 pb-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mt-4 mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</p>
          {g.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 text-[15px] ${
                  active ? "bg-brand-tint font-semibold text-brand" : "text-ink/85 hover:bg-ground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-1">
      {/* Side menu: always visible on a large screen, a drawer on a phone. */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close the menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-brand-dark/40 lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-dark text-[13px] font-bold text-white">
            {user.school ? initials(user.school.name) : "Y"}
          </div>
          <div className="min-w-0">
            <p className="text-sm leading-snug font-semibold">{schoolName}</p>
            <p className="truncate text-xs text-muted">YESE · {roleNames}</p>
          </div>
        </div>
        {menu}
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={() => void logout()}
            disabled={signingOut}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-ground hover:text-ink disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-8 print:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open the menu"
            aria-expanded={menuOpen}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-line lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {period && (
            <span className="rounded-full bg-brand-tint px-3 py-1.5 text-[13px] font-semibold text-brand">{period}</span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden="true">
              {`${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase()}
            </div>
            <div className="hidden text-sm leading-tight sm:block">
              <p className="font-semibold">{fullName}</p>
              <p className="text-xs text-muted">{roleNames}</p>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
