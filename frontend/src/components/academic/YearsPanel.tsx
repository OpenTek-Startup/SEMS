"use client";

import { useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/api/baseApi";
import {
  useCreateTermMutation,
  useCreateYearMutation,
  useDeleteTermMutation,
  useDeleteYearMutation,
  useGetYearsQuery,
  useSetCurrentYearMutation,
  useUpdateTermMutation,
  useUpdateYearMutation,
  type AcademicYear,
  type DatedInput,
  type Term,
} from "@/lib/api/academicApi";
import {
  Badge,
  dangerButton,
  Field,
  formatDay,
  Notice,
  smallButton,
  smallPrimaryButton,
  type Message,
} from "./academicUi";

const EMPTY: DatedInput = { name: "", startDate: "", endDate: "" };

/** Years and their terms. Only one year is current; terms fit inside their year. */
export default function YearsPanel({ canManage }: { canManage: boolean }) {
  const years = useGetYearsQuery();
  const [createYear, creating] = useCreateYearMutation();
  const [message, setMessage] = useState<Message>(null);
  const [adding, setAdding] = useState(false);

  async function run(action: () => Promise<unknown>, ok: string): Promise<boolean> {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
      return false;
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted">
          The current year is the one registers, marks and report cards use.
        </p>
        {canManage && !adding && (
          <button type="button" className={smallPrimaryButton} onClick={() => setAdding(true)}>
            Add an academic year
          </button>
        )}
      </div>

      {adding && (
        <DatedForm
          title="New academic year"
          namePlaceholder="2026-2027"
          initial={EMPTY}
          busy={creating.isLoading}
          submitLabel="Create year"
          onCancel={() => setAdding(false)}
          onSubmit={async (value) => {
            const done = await run(() => createYear(value).unwrap(), `Academic year ${value.name} created.`);
            if (done) setAdding(false);
          }}
        />
      )}

      <Notice message={message} />

      {years.isLoading && <p className="mt-6 text-sm text-muted">Loading years…</p>}
      {years.error && (
        <p role="alert" className="mt-6 text-sm text-err">
          {apiErrorMessage(years.error)}
        </p>
      )}
      {years.data && years.data.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-white p-6 text-sm text-muted">
          No academic year yet.{canManage ? " Add the first one: it becomes the current year." : ""}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {years.data?.map((year) => (
          <YearCard key={year.id} year={year} canManage={canManage} run={run} />
        ))}
      </div>
    </section>
  );
}

type Run = (action: () => Promise<unknown>, ok: string) => Promise<boolean>;

function YearCard({ year, canManage, run }: { year: AcademicYear; canManage: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [addingTerm, setAddingTerm] = useState(false);
  const [updateYear, updating] = useUpdateYearMutation();
  const [setCurrent] = useSetCurrentYearMutation();
  const [deleteYear] = useDeleteYearMutation();
  const [createTerm, creatingTerm] = useCreateTermMutation();

  return (
    <article className="rounded-xl border border-line bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {year.name}
            {year.isCurrent && <Badge tone="ok">Current year</Badge>}
          </h2>
          <p className="text-sm text-muted">
            {formatDay(year.startDate)} – {formatDay(year.endDate)}
          </p>
        </div>
        {canManage && !editing && (
          <div className="flex flex-wrap gap-2">
            {!year.isCurrent && (
              <button
                type="button"
                className={smallButton}
                onClick={() => void run(() => setCurrent({ id: year.id }).unwrap(), `${year.name} is now the current year.`)}
              >
                Make current
              </button>
            )}
            <button type="button" className={smallButton} onClick={() => setEditing(true)}>
              Edit
            </button>
            {!year.isCurrent && (
              <button
                type="button"
                className={dangerButton}
                onClick={() => {
                  if (window.confirm(`Delete the academic year ${year.name}?`)) {
                    void run(() => deleteYear({ id: year.id }).unwrap(), `${year.name} deleted.`);
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </header>

      {editing && (
        <div className="px-5">
          <DatedForm
            title={`Edit ${year.name}`}
            initial={{ name: year.name, startDate: year.startDate, endDate: year.endDate }}
            busy={updating.isLoading}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (value) => {
              const done = await run(() => updateYear({ id: year.id, ...value }).unwrap(), `${value.name} saved.`);
              if (done) setEditing(false);
            }}
          />
        </div>
      )}

      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Terms</h3>
          {canManage && !addingTerm && (
            <button type="button" className={smallButton} onClick={() => setAddingTerm(true)}>
              Add a term
            </button>
          )}
        </div>

        {addingTerm && (
          <DatedForm
            title={`New term of ${year.name}`}
            namePlaceholder="First Term"
            initial={EMPTY}
            busy={creatingTerm.isLoading}
            submitLabel="Add term"
            onCancel={() => setAddingTerm(false)}
            onSubmit={async (value) => {
              const done = await run(
                () => createTerm({ yearId: year.id, ...value }).unwrap(),
                `${value.name} added to ${year.name}.`,
              );
              if (done) setAddingTerm(false);
            }}
          />
        )}

        {year.terms.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No term yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {year.terms.map((term) => (
              <TermRow key={term.id} term={term} canManage={canManage} run={run} />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function TermRow({ term, canManage, run }: { term: Term; canManage: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [updateTerm, updating] = useUpdateTermMutation();
  const [deleteTerm] = useDeleteTermMutation();

  if (editing) {
    return (
      <li>
        <DatedForm
          title={`Edit ${term.name}`}
          initial={{ name: term.name, startDate: term.startDate, endDate: term.endDate }}
          busy={updating.isLoading}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (value) => {
            const done = await run(() => updateTerm({ id: term.id, ...value }).unwrap(), `${value.name} saved.`);
            if (done) setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <p className="text-sm">
        <span className="font-semibold">{term.name}</span>
        <span className="ml-2 text-muted">
          {formatDay(term.startDate)} – {formatDay(term.endDate)}
        </span>
        {term.isCurrent && (
          <span className="ml-2">
            <Badge>Now</Badge>
          </span>
        )}
      </p>
      {canManage && (
        <div className="flex gap-2">
          <button type="button" className={smallButton} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className={dangerButton}
            onClick={() => {
              if (window.confirm(`Delete ${term.name}?`)) {
                void run(() => deleteTerm({ id: term.id }).unwrap(), `${term.name} deleted.`);
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

/** Name + start + end, used for years and terms. */
function DatedForm(props: {
  title: string;
  initial: DatedInput;
  namePlaceholder?: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (value: DatedInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<DatedInput>(props.initial);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void props.onSubmit({ ...value, name: value.name.trim() });
  }

  return (
    <form onSubmit={submit} className="my-3 rounded-lg border border-line bg-ground p-4">
      <p className="text-sm font-semibold">{props.title}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field
          label="Name"
          value={value.name}
          placeholder={props.namePlaceholder}
          onChange={(name) => setValue((v) => ({ ...v, name }))}
        />
        <Field
          label="Start"
          type="date"
          value={value.startDate}
          onChange={(startDate) => setValue((v) => ({ ...v, startDate }))}
        />
        <Field
          label="End"
          type="date"
          value={value.endDate}
          onChange={(endDate) => setValue((v) => ({ ...v, endDate }))}
        />
        <button type="submit" disabled={props.busy} className={smallPrimaryButton}>
          {props.busy ? "Saving…" : props.submitLabel}
        </button>
        <button type="button" onClick={props.onCancel} className={smallButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
