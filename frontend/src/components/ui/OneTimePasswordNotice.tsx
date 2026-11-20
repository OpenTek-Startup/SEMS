"use client";

import { useState } from "react";
import { secondaryButtonClass } from "@/components/ui/styles";

/** A one-time password shown once to an administrator (new account or reset). */
export interface OneTimePassword {
  name: string;
  email: string;
  password: string;
}

export default function OneTimePasswordNotice(props: { value: OneTimePassword; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div role="status" className="mt-6 rounded-xl border border-brand/30 bg-brand-tint p-5">
      <p className="font-semibold">One-time password for {props.value.name}</p>
      <p className="mt-1 text-sm text-muted">
        Give it to them in person. They sign in with <strong>{props.value.email}</strong> and must
        choose their own password straight away. It will not be shown again.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="rounded-lg border border-line bg-white px-3 py-2 font-mono text-lg tracking-wider">
          {props.value.password}
        </code>
        <button type="button" onClick={() => void copy()} className={secondaryButtonClass}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={props.onClose} className={secondaryButtonClass}>
          Done
        </button>
      </div>
    </div>
  );
}
