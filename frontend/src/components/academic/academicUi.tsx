"use client";

import type { ReactNode } from "react";

/** Small shared pieces of the academic pages. */

export type Message = { kind: "ok" | "error"; text: string } | null;

/** "2026-09-07" -> "7 Sep 2026" (calendar days are shown as written, in UTC). */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function Notice({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role={message.kind === "error" ? "alert" : "status"}
      className={`mt-4 rounded-lg p-3 text-sm ${
        message.kind === "error" ? "bg-err-bg text-err" : "bg-ok-bg text-ok"
      }`}
    >
      {message.text}
    </p>
  );
}

export function Badge({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "ok" | "muted" }) {
  const colors = {
    brand: "bg-brand-tint text-brand",
    ok: "bg-ok-bg text-ok",
    muted: "bg-ground text-muted",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colors}`}>{children}</span>;
}

/** A compact text/number/date field used in the inline forms. */
export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  placeholder?: string;
  width?: string;
  required?: boolean;
}) {
  return (
    <label className={`block text-xs font-medium text-muted ${props.width ?? "w-40"}`}>
      {props.label}
      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        required={props.required ?? true}
        min={props.type === "number" ? 1 : undefined}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

export const smallButton =
  "h-9 rounded-lg border border-line bg-white px-3 text-xs font-medium hover:bg-ground disabled:opacity-60";

export const smallPrimaryButton =
  "h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60";

export const dangerButton =
  "h-9 rounded-lg border border-err/30 bg-white px-3 text-xs font-medium text-err hover:bg-err-bg disabled:opacity-60";
