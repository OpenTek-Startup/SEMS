"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRestoreSessionMutation } from "@/lib/api/authApi";
import { sessionCheckRetried } from "@/lib/auth/authSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

const CHANGE_PASSWORD_PATH = "/change-password";

/**
 * Wraps every signed-in page:
 *  - on load, restores the session from the refresh cookie
 *  - not signed in            -> /login
 *  - must change password     -> /change-password (nothing else is reachable)
 * The backend enforces the same rules; this only keeps the UI in step.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.auth.status);
  const mustChange = useAppSelector((state) => !!state.auth.user?.mustChangePassword);
  const [restoreSession] = useRestoreSessionMutation();

  useEffect(() => {
    if (status === "unknown") void restoreSession();
  }, [status, restoreSession]);

  const onChangePage = pathname === CHANGE_PASSWORD_PATH;
  const blockedByPassword = status === "authenticated" && mustChange && !onChangePage;

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
    else if (blockedByPassword) router.replace(CHANGE_PASSWORD_PATH);
  }, [status, blockedByPassword, router]);

  if (status === "unreachable") {
    return (
      <CenteredCard>
        <p className="font-semibold">Cannot reach the YESE server</p>
        <p className="mt-1 text-sm text-muted">
          Check your connection, or that the backend is running, then try again.
        </p>
        <button
          type="button"
          onClick={() => dispatch(sessionCheckRetried())}
          className="mt-4 h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Try again
        </button>
      </CenteredCard>
    );
  }

  if (status !== "authenticated" || blockedByPassword) {
    return (
      <CenteredCard>
        <p className="text-sm text-muted" role="status">
          Checking your session…
        </p>
      </CenteredCard>
    );
  }

  return <>{children}</>;
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6 text-center">
        {children}
      </div>
    </main>
  );
}
