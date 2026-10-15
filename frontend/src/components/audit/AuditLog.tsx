"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import { useGetAuditQuery, type AuditPerson } from "@/lib/api/auditApi";
import { AUDIT_CATEGORIES, describeAudit, isWarning } from "@/lib/audit/auditLabels";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import AppHeader from "@/components/layout/AppHeader";
import { fieldClass, labelClass, secondaryButtonClass } from "@/components/ui/styles";

const PAGE_SIZE = 25;

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** /audit — who did what, when, in this school (needs core.audit.view). */
export default function AuditLog() {
  const canView = useCan(PERMISSIONS.auditView);

  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [person, setPerson] = useState<AuditPerson | null>(null);
  const [page, setPage] = useState(1);

  const audit = useGetAuditQuery(
    {
      action: category || undefined,
      actorUserId: person?.id,
      from: from || undefined,
      to: to || undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    { skip: !canView },
  );

  // Every filter change starts again from page 1.
  function changeFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-warn">
            You do not have permission to see the audit log of this school.
          </p>
        </main>
      </div>
    );
  }

  const data = audit.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(category || from || to || person);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-muted">
          Who did what, and when, in this school. Entries cannot be edited or deleted.
        </p>

        <section aria-label="Filters" className="mt-6 grid gap-4 rounded-xl border border-line bg-white p-5 sm:grid-cols-4">
          <div>
            <label htmlFor="category" className={labelClass}>
              Events
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => changeFilter(() => setCategory(e.target.value))}
              className={fieldClass}
            >
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="from" className={labelClass}>
              From
            </label>
            <input
              id="from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => changeFilter(() => setFrom(e.target.value))}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="to" className={labelClass}>
              To
            </label>
            <input
              id="to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => changeFilter(() => setTo(e.target.value))}
              className={fieldClass}
            />
          </div>
          <div>
            <p className={labelClass}>Person</p>
            {person ? (
              <p className="mt-1 flex h-11 items-center justify-between gap-2 rounded-lg border border-line px-3 text-sm">
                <span className="truncate">{person.name}</span>
                <button
                  type="button"
                  onClick={() => changeFilter(() => setPerson(null))}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Clear
                </button>
              </p>
            ) : (
              <p className="mt-1 flex h-11 items-center text-xs text-muted">
                Click a name in the list to see only that person.
              </p>
            )}
          </div>
        </section>

        <section className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          {audit.isLoading && <p className="p-5 text-sm text-muted">Loading the audit log…</p>}
          {audit.error && (
            <p role="alert" className="p-5 text-sm text-err">
              {apiErrorMessage(audit.error)}
            </p>
          )}
          {data && data.items.length === 0 && (
            <p className="p-5 text-sm text-muted">
              {filtered ? "No events match these filters." : "No events yet."}
            </p>
          )}
          {data && data.items.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Who</th>
                  <th className="px-4 py-3 font-semibold">What</th>
                  <th className="px-4 py-3 font-semibold">From</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-t border-line first:border-t-0 align-top ${
                      isWarning(item.action) ? "bg-warn-bg/60" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {formatWhen(item.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {item.actor ? (
                        <button
                          type="button"
                          onClick={() => changeFilter(() => setPerson(item.actor))}
                          className="text-left font-medium text-ink hover:text-brand hover:underline"
                          title={`Show only ${item.actor.name}`}
                        >
                          {item.actor.name}
                          <span className="block text-xs font-normal text-muted">{item.actor.email}</span>
                        </button>
                      ) : (
                        <span className="text-muted">Unknown</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {describeAudit(item)}
                      <span className="block font-mono text-xs text-muted">{item.action}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">
                      {item.ipAddress ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {data && data.total > 0 && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
            <p className="text-muted">
              {data.total} event{data.total === 1 ? "" : "s"} · page {data.page} of {pages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || audit.isFetching}
                className={secondaryButtonClass}
              >
                Newer
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= pages || audit.isFetching}
                className={secondaryButtonClass}
              >
                Older
              </button>
            </div>
          </nav>
        )}
      </main>
    </div>
  );
}
