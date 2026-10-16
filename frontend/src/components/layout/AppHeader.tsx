"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLogoutMutation } from "@/lib/api/authApi";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { useAppSelector } from "@/store/hooks";
import { secondaryButtonClass } from "@/components/ui/styles";

type NavItem = {
  href: string;
  label: string;
  /** null: any signed-in school user; "superAdmin": the platform Super Admin only */
  permission: string | null | "superAdmin";
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/users", label: "Users", permission: PERMISSIONS.userView },
  { href: "/audit", label: "Audit log", permission: PERMISSIONS.auditView },
  { href: "/platform", label: "Schools & modules", permission: "superAdmin" },
];

/**
 * Top bar shared by the signed-in pages. Menu entries the user has no
 * permission for are hidden (the backend refuses them anyway).
 */
export default function AppHeader() {
  const pathname = usePathname();
  const user = useAppSelector((state) => state.auth.user);
  const [logout, { isLoading }] = useLogoutMutation();
  if (!user) return null;

  const roleNames = user.roles.map((r) => r.name).join(", ") || "No role yet";
  const links = NAV.filter((item) => {
    if (item.permission === null) return true;
    if (item.permission === "superAdmin") return user.isSuperAdmin;
    return can(user, item.permission);
  });

  return (
    <header className="border-b border-line bg-white">
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-bold text-white">
            Y
          </div>
          <div>
            <p className="text-sm font-semibold">{user.school?.name ?? "YESE platform"}</p>
            <p className="text-xs text-muted">YESE · {roleNames}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={isLoading}
            className={secondaryButtonClass}
          >
            {isLoading ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 px-4">
        {links.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
