"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChangePasswordMutation, useLogoutMutation } from "@/lib/api/authApi";
import { apiErrorMessage } from "@/lib/api/baseApi";
import { passwordRules } from "@/lib/auth/passwordPolicy";
import { useAppSelector } from "@/store/hooks";
import { fieldClass, labelClass, primaryButtonClass } from "@/components/ui/styles";

/**
 * Used both for the forced first-time change (seeded / reset accounts)
 * and for a normal "change my password".
 */
export default function ChangePasswordForm() {
  const router = useRouter();
  const forced = useAppSelector((state) => !!state.auth.user?.mustChangePassword);
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const [logout] = useLogoutMutation();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rules = passwordRules(newPassword);
  const matches = confirm.length > 0 && confirm === newPassword;
  const ready = !!currentPassword && rules.every((r) => r.ok) && matches;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await changePassword({ currentPassword, newPassword }).unwrap();
      router.replace("/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not change your password. Please try again."));
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">
          {forced ? "Choose your own password" : "Change password"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {forced
            ? "Your account was created with a temporary password. Replace it before you continue."
            : "Other devices signed in to your account will be signed out."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="current" className={labelClass}>
              {forced ? "Temporary password" : "Current password"}
            </label>
            <input
              id="current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="new" className={labelClass}>
              New password
            </label>
            <input
              id="new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={fieldClass}
              aria-describedby="password-rules"
            />
            <ul id="password-rules" className="mt-2 space-y-1 text-sm">
              {rules.map((rule) => (
                <li key={rule.label} className={rule.ok ? "text-ok" : "text-muted"}>
                  {rule.ok ? "✓" : "○"} {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="confirm" className={labelClass}>
              Repeat new password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={fieldClass}
            />
            {confirm.length > 0 && !matches && (
              <p className="mt-1 text-sm text-err">The two passwords are different.</p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-err-bg p-3 text-sm text-err">
              {error}
            </p>
          )}

          <button type="submit" disabled={!ready || isLoading} className={primaryButtonClass}>
            {isLoading ? "Saving…" : "Save new password"}
          </button>
        </form>

        {!forced && (
          <Link
            href="/dashboard"
            className="mt-4 block text-center text-sm text-muted hover:underline"
          >
            Cancel
          </Link>
        )}
        {forced && (
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-4 w-full text-center text-sm text-muted hover:underline"
          >
            Sign out instead
          </button>
        )}
      </div>
    </main>
  );
}
