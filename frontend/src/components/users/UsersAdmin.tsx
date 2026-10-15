"use client";

import { useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateUserMutation,
  useGetRolesQuery,
  useGetUsersQuery,
  useResetUserPasswordMutation,
  useSetUserRolesMutation,
  useSetUserStatusMutation,
  type SchoolRole,
  type SchoolUser,
} from "@/lib/api/usersApi";
import { PERMISSIONS, useCan } from "@/lib/auth/permissions";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "@/components/layout/AppHeader";
import {
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/styles";

interface OneTimePassword {
  name: string;
  email: string;
  password: string;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

/** /users — school user administration (needs core.user.view). */
export default function UsersAdmin() {
  const me = useAppSelector((state) => state.auth.user);
  const canView = useCan(PERMISSIONS.userView);
  const canManage = useCan(PERMISSIONS.userManage);
  const canManageRoles = useCan(PERMISSIONS.roleManage);

  const users = useGetUsersQuery(undefined, { skip: !canView });
  const roles = useGetRolesQuery(undefined, { skip: !canView });

  const [showForm, setShowForm] = useState(false);
  const [editingRolesFor, setEditingRolesFor] = useState<string | null>(null);
  const [oneTime, setOneTime] = useState<OneTimePassword | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [setStatus] = useSetUserStatusMutation();
  const [resetPassword] = useResetUserPasswordMutation();

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-warn">
            You do not have permission to see the users of this school.
          </p>
        </main>
      </div>
    );
  }

  async function toggleStatus(user: SchoolUser) {
    const next = user.status === "active" ? "disabled" : "active";
    const verb = next === "disabled" ? "Disable" : "Enable";
    if (!window.confirm(`${verb} ${user.firstName} ${user.lastName}?`)) return;
    setActionError(null);
    try {
      await setStatus({ id: user.id, status: next }).unwrap();
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function reset(user: SchoolUser) {
    if (
      !window.confirm(
        `Reset the password of ${user.firstName} ${user.lastName}? They will be signed out everywhere.`,
      )
    ) {
      return;
    }
    setActionError(null);
    try {
      const result = await resetPassword({ id: user.id }).unwrap();
      setOneTime({
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        password: result.temporaryPassword,
      });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Users</h1>
            <p className="mt-1 text-sm text-muted">
              Accounts of {me?.school?.name ?? "this school"}.
            </p>
          </div>
          {canManage && !showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Add a user
            </button>
          )}
        </div>

        {oneTime && (
          <OneTimePasswordNotice value={oneTime} onClose={() => setOneTime(null)} />
        )}

        {showForm && (
          <CreateUserForm
            roles={roles.data ?? []}
            onCancel={() => setShowForm(false)}
            onCreated={(value) => {
              setShowForm(false);
              setOneTime(value);
            }}
          />
        )}

        {actionError && (
          <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
            {actionError}
          </p>
        )}

        <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
          {users.isLoading && <p className="p-5 text-sm text-muted">Loading users…</p>}
          {users.error && (
            <p role="alert" className="p-5 text-sm text-err">
              {apiErrorMessage(users.error)}
            </p>
          )}
          {users.data && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ground text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Roles</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Last sign-in</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((user) => {
                  const isMe = user.id === me?.id;
                  return (
                    <UserRow
                      key={user.id}
                      user={user}
                      isMe={isMe}
                      roles={roles.data ?? []}
                      canManage={canManage && !isMe}
                      canManageRoles={canManageRoles && !isMe}
                      editingRoles={editingRolesFor === user.id}
                      onEditRoles={() => setEditingRolesFor(user.id)}
                      onDoneRoles={() => setEditingRolesFor(null)}
                      onToggleStatus={() => void toggleStatus(user)}
                      onReset={() => void reset(user)}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

function UserRow(props: {
  user: SchoolUser;
  isMe: boolean;
  roles: SchoolRole[];
  canManage: boolean;
  canManageRoles: boolean;
  editingRoles: boolean;
  onEditRoles: () => void;
  onDoneRoles: () => void;
  onToggleStatus: () => void;
  onReset: () => void;
}) {
  const { user } = props;
  const disabled = user.status === "disabled";

  return (
    <>
      <tr className="border-t border-line first:border-t-0 align-top">
        <td className="px-4 py-3">
          <p className="font-semibold">
            {user.firstName} {user.lastName}
            {props.isMe && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
          </p>
          <p className="text-xs text-muted">{user.email}</p>
        </td>
        <td className="px-4 py-3">
          {user.roles.length === 0 ? (
            <span className="text-muted">No role</span>
          ) : (
            user.roles.map((r) => r.name).join(", ")
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              disabled ? "bg-err-bg text-err" : "bg-ok-bg text-ok"
            }`}
          >
            {disabled ? "Disabled" : "Active"}
          </span>
          {user.mustChangePassword && !disabled && (
            <p className="mt-1 text-xs text-warn">Must change password</p>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-muted">{formatDate(user.lastLoginAt)}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap justify-end gap-2">
            {props.canManageRoles && !props.editingRoles && (
              <button type="button" onClick={props.onEditRoles} className={secondaryButtonClass}>
                Roles
              </button>
            )}
            {props.canManage && (
              <>
                <button type="button" onClick={props.onReset} className={secondaryButtonClass}>
                  Reset password
                </button>
                <button type="button" onClick={props.onToggleStatus} className={secondaryButtonClass}>
                  {disabled ? "Enable" : "Disable"}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {props.editingRoles && (
        <tr className="bg-ground">
          <td colSpan={5} className="px-4 py-3">
            <RoleEditor user={user} roles={props.roles} onDone={props.onDoneRoles} />
          </td>
        </tr>
      )}
    </>
  );
}

function RoleChecklist(props: {
  roles: SchoolRole[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {props.roles.map((role) => {
        const checked = props.selected.includes(role.id);
        return (
          <label key={role.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                props.onChange(
                  checked
                    ? props.selected.filter((id) => id !== role.id)
                    : [...props.selected, role.id],
                )
              }
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{role.name}</span>
              <span className="block text-xs text-muted">
                {role.permissions.length} permissions
                {role.isSystem ? " · base role" : " · custom role"}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function RoleEditor(props: { user: SchoolUser; roles: SchoolRole[]; onDone: () => void }) {
  const [selected, setSelected] = useState(props.user.roles.map((r) => r.id));
  const [error, setError] = useState<string | null>(null);
  const [setRoles, { isLoading }] = useSetUserRolesMutation();

  async function save() {
    setError(null);
    try {
      await setRoles({ id: props.user.id, roleIds: selected }).unwrap();
      props.onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">
        Roles of {props.user.firstName} {props.user.lastName}
      </p>
      <RoleChecklist roles={props.roles} selected={selected} onChange={setSelected} />
      {error && (
        <p role="alert" className="mt-2 text-sm text-err">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={isLoading}
          className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {isLoading ? "Saving…" : "Save roles"}
        </button>
        <button type="button" onClick={props.onDone} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CreateUserForm(props: {
  roles: SchoolRole[];
  onCancel: () => void;
  onCreated: (value: OneTimePassword) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createUser, { isLoading }] = useCreateUserMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createUser({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roleIds,
      }).unwrap();
      props.onCreated({
        name: `${result.user.firstName} ${result.user.lastName}`,
        email: result.user.email,
        password: result.temporaryPassword,
      });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create the user."));
    }
  }

  const ready = firstName.trim() && lastName.trim() && email.trim();

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-line bg-white p-5" noValidate>
      <h2 className="font-semibold">Add a user</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="firstName" className={labelClass}>
            First name
          </label>
          <input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="lastName" className={labelClass}>
            Last name
          </label>
          <input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="newEmail" className={labelClass}>
            Email
          </label>
          <input
            id="newEmail"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className={labelClass}>Roles</legend>
        <div className="mt-2">
          <RoleChecklist roles={props.roles} selected={roleIds} onChange={setRoleIds} />
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={!ready || isLoading} className={`${primaryButtonClass} sm:w-auto sm:px-6`}>
          {isLoading ? "Creating…" : "Create user"}
        </button>
        <button type="button" onClick={props.onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function OneTimePasswordNotice(props: { value: OneTimePassword; onClose: () => void }) {
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
