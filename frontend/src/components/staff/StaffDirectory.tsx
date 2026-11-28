"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateStaffMutation,
  useGetLinkableAccountsQuery,
  useGetStaffQuery,
  useLinkStaffAccountMutation,
  useSetStaffStatusMutation,
  useUpdateStaffMutation,
  type StaffCategory,
  type StaffMember,
  type StaffStatus,
} from "@/lib/api/staffApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useActiveModules } from "@/lib/modules/useModules";
import { useAppSelector } from "@/store/hooks";
import { fieldClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";

const CATEGORY_LABEL: Record<StaffCategory, string> = {
  teaching: "Teaching",
  non_teaching: "Non-teaching",
};

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The value of `value`, settled for `ms` (search as you type without a request per key). */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type Panel = { kind: "create" } | { kind: "edit"; member: StaffMember } | null;

/** /staff — staff records of the school (module "staff", needs staff.record.view). */
export default function StaffDirectory() {
  const me = useAppSelector((state) => state.auth.user);
  const canView = useCan(PERMISSIONS.staffView);
  const canEdit = useCan(PERMISSIONS.staffEdit);
  const modules = useActiveModules();
  const moduleOn = modules.codes.has("staff");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StaffStatus | "">("active");
  const [category, setCategory] = useState<StaffCategory | "">("");
  const debouncedSearch = useDebounced(search);

  const staff = useGetStaffQuery(
    { search: debouncedSearch, status: status || undefined, category: category || undefined },
    { skip: !canView || !moduleOn },
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [setStaffStatus] = useSetStaffStatusMutation();

  if (modules.isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (!canView || !moduleOn) {
    return (
      <div className="flex flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-warn">
            {!moduleOn
              ? "The Staff module is not active for this school."
              : "You do not have permission to see the staff of this school."}
          </p>
        </main>
      </div>
    );
  }

  async function toggleStatus(member: StaffMember) {
    const next: StaffStatus = member.status === "active" ? "inactive" : "active";
    const question =
      next === "inactive"
        ? `Mark ${member.fullName} as having left the school? The record is kept.`
        : `Mark ${member.fullName} as active again?`;
    if (!window.confirm(question)) return;
    setActionError(null);
    try {
      await setStaffStatus({ id: member.id, status: next }).unwrap();
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  const rows = staff.data ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">People</p>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold">Staff</h1>
            <p className="mt-1 text-sm text-muted">
              Teaching and non-teaching staff of {me?.school?.name ?? "this school"}.
            </p>
          </div>
          {canEdit && panel?.kind !== "create" && (
            <button
              type="button"
              onClick={() => setPanel({ kind: "create" })}
              className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Add a staff member
            </button>
          )}
        </div>

        {panel && (
          <StaffForm
            key={panel.kind === "edit" ? panel.member.id : "new"}
            member={panel.kind === "edit" ? panel.member : null}
            onDone={() => setPanel(null)}
          />
        )}

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="staffSearch" className={labelClass}>
              Search
            </label>
            <input
              id="staffSearch"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, staff number, position, phone…"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="staffStatus" className={labelClass}>
              Status
            </label>
            <select
              id="staffStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value as StaffStatus | "")}
              className={fieldClass}
            >
              <option value="active">Active</option>
              <option value="inactive">Left the school</option>
              <option value="">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="staffCategory" className={labelClass}>
              Category
            </label>
            <select
              id="staffCategory"
              value={category}
              onChange={(e) => setCategory(e.target.value as StaffCategory | "")}
              className={fieldClass}
            >
              <option value="">All</option>
              <option value="teaching">Teaching</option>
              <option value="non_teaching">Non-teaching</option>
            </select>
          </div>
        </div>

        {actionError && (
          <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
            {actionError}
          </p>
        )}

        <section className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          {staff.isLoading && <p className="p-5 text-sm text-muted">Loading staff…</p>}
          {staff.error && (
            <p role="alert" className="p-5 text-sm text-err">
              {apiErrorMessage(staff.error)}
            </p>
          )}
          {staff.data && rows.length === 0 && (
            <p className="p-5 text-sm text-muted">
              {search || category || status !== "active" ? "No staff match these filters." : "No staff recorded yet."}
            </p>
          )}
          {rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Staff no.</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Position</th>
                  <th className="px-4 py-3 font-semibold">Hired</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t border-line align-top first:border-t-0">
                    <td className="px-4 py-3 font-mono text-xs">{m.staffNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{m.fullName}</p>
                      <p className="text-xs text-muted">{[m.email, m.phone].filter(Boolean).join(" · ") || "No contact"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{m.position}</p>
                      <p className="text-xs text-muted">
                        {CATEGORY_LABEL[m.category]}
                        {m.status === "inactive" && <span className="ml-1 text-err">· left the school</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDay(m.hireDate)}</td>
                    <td className="px-4 py-3 text-xs">
                      {m.account ? (
                        <span title="Signs in with this account">{m.account.email}</span>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setPanel({ kind: "edit", member: m })}
                            className={secondaryButtonClass}
                          >
                            Edit
                          </button>
                          <button type="button" onClick={() => void toggleStatus(m)} className={secondaryButtonClass}>
                            {m.status === "active" ? "Has left" : "Reactivate"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {rows.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {rows.length} staff member{rows.length === 1 ? "" : "s"}
          </p>
        )}
      </main>
    </div>
  );
}

/** Create a staff record, or edit one (fields, then the linked account). */
function StaffForm(props: { member: StaffMember | null; onDone: () => void }) {
  const m = props.member;
  const [staffNumber, setStaffNumber] = useState(m?.staffNumber ?? "");
  const [firstName, setFirstName] = useState(m?.firstName ?? "");
  const [lastName, setLastName] = useState(m?.lastName ?? "");
  const [position, setPosition] = useState(m?.position ?? "");
  const [category, setCategory] = useState<StaffCategory>(m?.category ?? "teaching");
  const [email, setEmail] = useState(m?.email ?? "");
  const [phone, setPhone] = useState(m?.phone ?? "");
  const [hireDate, setHireDate] = useState(m?.hireDate ?? "");
  const [userId, setUserId] = useState(m?.account?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const accounts = useGetLinkableAccountsQuery();
  const [createStaff, create] = useCreateStaffMutation();
  const [updateStaff, update] = useUpdateStaffMutation();
  const [linkAccount, link] = useLinkStaffAccountMutation();
  const saving = create.isLoading || update.isLoading || link.isLoading;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const fields = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      position: position.trim(),
      category,
      email: email.trim() || null,
      phone: phone.trim() || null,
      hireDate: hireDate || null,
    };
    try {
      if (!m) {
        await createStaff({ ...fields, staffNumber: staffNumber.trim() || undefined, userId: userId || null }).unwrap();
      } else {
        await updateStaff({ id: m.id, body: { ...fields, staffNumber: staffNumber.trim() } }).unwrap();
        if ((m.account?.id ?? "") !== userId) await linkAccount({ id: m.id, userId: userId || null }).unwrap();
      }
      props.onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the staff record."));
    }
  }

  const ready = firstName.trim() && lastName.trim() && position.trim() && (!m || staffNumber.trim());
  // The current account stays selectable while editing.
  const options = [
    ...(m?.account ? [{ id: m.account.id, label: m.account.email }] : []),
    ...(accounts.data ?? []).map((a) => ({ id: a.id, label: `${a.lastName} ${a.firstName} · ${a.email}` })),
  ];

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-line bg-white p-5" noValidate>
      <h2 className="font-semibold">{m ? `Edit ${m.fullName}` : "Add a staff member"}</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="staffFirstName" className={labelClass}>
            First name
          </label>
          <input id="staffFirstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="staffLastName" className={labelClass}>
            Last name
          </label>
          <input id="staffLastName" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="staffNumber" className={labelClass}>
            Staff number
          </label>
          <input
            id="staffNumber"
            value={staffNumber}
            onChange={(e) => setStaffNumber(e.target.value)}
            placeholder={m ? undefined : "Generated if left empty"}
            className={`${fieldClass} font-mono`}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="staffPosition" className={labelClass}>
            Position
          </label>
          <input
            id="staffPosition"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="e.g. Mathematics teacher, Bursar"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="staffCategoryInput" className={labelClass}>
            Category
          </label>
          <select
            id="staffCategoryInput"
            value={category}
            onChange={(e) => setCategory(e.target.value as StaffCategory)}
            className={fieldClass}
          >
            <option value="teaching">Teaching</option>
            <option value="non_teaching">Non-teaching</option>
          </select>
        </div>
        <div>
          <label htmlFor="staffEmail" className={labelClass}>
            Email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="staffEmail"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="staffPhone" className={labelClass}>
            Phone <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="staffPhone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+237 6XX XX XX XX"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="staffHireDate" className={labelClass}>
            Hired on <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="staffHireDate"
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="staffAccount" className={labelClass}>
            User account <span className="font-normal text-muted">(optional)</span>
          </label>
          <select id="staffAccount" value={userId} onChange={(e) => setUserId(e.target.value)} className={fieldClass}>
            <option value="">No account (does not sign in)</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Link the account this person signs in with. Create accounts on the Users page.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={!ready || saving} className={`${primaryButtonClass} sm:w-auto sm:px-6`}>
          {saving ? "Saving…" : m ? "Save changes" : "Add staff member"}
        </button>
        <button type="button" onClick={props.onDone} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
