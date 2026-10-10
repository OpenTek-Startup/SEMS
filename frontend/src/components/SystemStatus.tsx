"use client";

import { useGetCurrentTenantQuery, useGetHealthQuery } from "@/lib/api/healthApi";
import { httpStatus, isNetworkError } from "@/lib/api/baseApi";
import { API_URL, DEV_TENANT } from "@/lib/config";

type State = "ok" | "down" | "checking" | "unknown";

const LABEL: Record<State, string> = {
  ok: "Working",
  down: "Not reachable",
  checking: "Checking…",
  unknown: "Unknown",
};

const BADGE: Record<State, string> = {
  ok: "bg-ok-bg text-ok",
  down: "bg-err-bg text-err",
  checking: "bg-line/60 text-muted",
  unknown: "bg-line/60 text-muted",
};

function StatusRow({
  name,
  detail,
  state,
}: {
  name: string;
  detail: string;
  state: State;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-line py-4 first:border-t-0">
      <div>
        <p className="font-semibold">{name}</p>
        <p className="text-sm text-muted">{detail}</p>
      </div>
      <span
        className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${BADGE[state]}`}
      >
        {LABEL[state]}
      </span>
    </li>
  );
}

export default function SystemStatus() {
  const { data, error, isLoading, isFetching, refetch, fulfilledTimeStamp } =
    useGetHealthQuery(undefined, { pollingInterval: 30_000 });
  const school = useGetCurrentTenantQuery();

  // Work out each layer's state from the single /health call:
  // - network error      -> backend down (database unknown)
  // - HTTP 503           -> backend up, database down
  // - success            -> both up
  const networkDown = !!error && isNetworkError(error);
  const backend: State = isLoading ? "checking" : networkDown ? "down" : "ok";
  const database: State = isLoading
    ? "checking"
    : data
      ? "ok"
      : networkDown
        ? "unknown"
        : "down";

  const schoolState: State = school.isLoading
    ? "checking"
    : school.data
      ? "ok"
      : "down";
  const schoolDetail = school.data
    ? `${school.data.name} (${school.data.slug})`
    : `X-Tenant: ${DEV_TENANT} — ${httpStatus(school.error) === 404 ? "unknown school, run pnpm db:seed" : "not resolved"}`;

  const lastChecked = fulfilledTimeStamp
    ? new Date(fulfilledTimeStamp).toLocaleTimeString()
    : "—";

  return (
    <section
      aria-labelledby="status-title"
      className="w-full max-w-xl rounded-xl border border-line bg-white p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="status-title" className="text-lg font-semibold">
            System status
          </h2>
          <p className="text-sm text-muted">
            Frontend, backend, database and school resolution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            refetch();
            school.refetch();
          }}
          disabled={isFetching}
          className="h-10 shrink-0 rounded-lg border border-line px-4 text-sm font-medium hover:bg-ground disabled:opacity-60"
        >
          {isFetching ? "Checking…" : "Check again"}
        </button>
      </div>

      <ul className="mt-4">
        <StatusRow name="Frontend" detail="Next.js app (this page)" state="ok" />
        <StatusRow
          name="Backend API"
          detail={API_URL}
          state={backend}
        />
        <StatusRow
          name="Database"
          detail="Neon PostgreSQL via Prisma"
          state={database}
        />
        <StatusRow name="School (tenant)" detail={schoolDetail} state={schoolState} />
      </ul>

      {networkDown && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
          The backend did not answer. Start it with <code>pnpm start:dev</code> in
          the backend folder, and check that NEXT_PUBLIC_API_URL points to it.
        </p>
      )}
      {!networkDown && httpStatus(error) === 503 && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg p-3 text-sm text-err">
          The backend is running but cannot reach the database. Check
          DATABASE_URL in backend/.env.
        </p>
      )}

      <p className="mt-4 text-xs text-muted">Last successful check: {lastChecked}</p>
    </section>
  );
}
