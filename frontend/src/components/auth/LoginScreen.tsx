"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLoginMutation, useRestoreSessionMutation } from "@/lib/api/authApi";
import { apiErrorMessage, httpStatus } from "@/lib/api/baseApi";
import { useGetCurrentTenantQuery } from "@/lib/api/healthApi";
import { DEV_TENANT } from "@/lib/config";
import { useAppSelector } from "@/store/hooks";
import { fieldClass, labelClass, primaryButtonClass } from "@/components/ui/styles";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

/** Sign-in page, as in mockup 01 (school panel on the left, form on the right). */
export default function LoginScreen() {
  const router = useRouter();
  const auth = useAppSelector((state) => state.auth);
  const school = useGetCurrentTenantQuery();
  const [login, { isLoading }] = useLoginMutation();
  const [restoreSession] = useRestoreSessionMutation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in on this device? Skip the form.
  useEffect(() => {
    if (auth.status === "unknown") void restoreSession();
  }, [auth.status, restoreSession]);

  useEffect(() => {
    if (auth.status === "authenticated") {
      router.replace(auth.user?.mustChangePassword ? "/change-password" : "/dashboard");
    }
  }, [auth.status, auth.user?.mustChangePassword, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await login({ email: email.trim(), password }).unwrap();
      // Redirect happens in the effect above once the store says "authenticated".
    } catch (err) {
      setError(apiErrorMessage(err, "Sign-in failed. Please try again."));
    }
  }

  const unknownSchool = httpStatus(school.error) === 404;
  // No school in the request (NEXT_PUBLIC_TENANT empty): platform Super Admin sign-in.
  const platform = httpStatus(school.error) === 400;
  const schoolName = school.data?.name ?? (platform ? "YESE platform" : undefined);

  return (
    <main className="flex flex-1 flex-col md:flex-row">
      {/* School panel */}
      <section className="flex flex-col justify-between gap-10 bg-brand-dark px-8 py-8 text-white md:w-2/5 md:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-base font-bold">
            Y
          </div>
          <p className="font-bold tracking-wide">
            YESE <span className="ml-1 text-xs font-normal text-white/70">by OpenTek</span>
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
            Your school
          </p>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-brand-dark">
              {schoolName ? initials(schoolName) : "…"}
            </div>
            <p className="text-xl font-semibold leading-tight">
              {schoolName ?? (unknownSchool ? "Unknown school" : school.isError ? "Server not reachable" : "Loading…")}
            </p>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/80">
            Registers, marks, results and report cards in one place — for
            administrators, teachers, students and parents.
          </p>
        </div>

        <p className="text-xs text-white/60">OpenTek School Enterprise Management System</p>
      </section>

      {/* Form */}
      <section className="flex flex-1 items-center justify-center bg-ground px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the account your school gave you.</p>

          {auth.notice && (
            <p role="status" className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn">
              {auth.notice}
            </p>
          )}
          {unknownSchool && (
            <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
              School “{DEV_TENANT}” was not found. Check NEXT_PUBLIC_TENANT, or run
              pnpm db:seed in the backend.
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className={labelClass}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-err-bg p-3 text-sm text-err">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className={primaryButtonClass}
            >
              {isLoading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted">
            Signing in to <strong>{school.data?.slug ?? (DEV_TENANT || "the platform")}</strong> on YESE. For
            security, you will be signed out after 15 minutes without activity. Forgot your
            password? Ask your school administrator to reset it.
          </p>
        </div>
      </section>
    </main>
  );
}
