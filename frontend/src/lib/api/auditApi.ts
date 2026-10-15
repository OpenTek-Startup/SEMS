import { baseApi, type ApiSuccess } from "./baseApi";

export interface AuditPerson {
  id: string;
  name: string;
  email: string;
}

export interface AuditItem {
  id: string;
  action: string;
  createdAt: string;
  ipAddress: string | null;
  actor: AuditPerson | null;
  entity: string | null;
  entityId: string | null;
  target: AuditPerson | null;
  detail: Record<string, unknown> | null;
}

export interface AuditPage {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditQuery {
  /** "auth." / "user." (category) or one exact action */
  action?: string;
  actorUserId?: string;
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const auditBase = baseApi.enhanceEndpoints({ addTagTypes: ["Audit"] });

export const auditApi = auditBase.injectEndpoints({
  endpoints: (build) => ({
    getAudit: build.query<AuditPage, AuditQuery>({
      query: (params) => {
        // Only send filters that are set.
        const clean = Object.fromEntries(
          Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
        );
        return { url: "/audit", params: clean };
      },
      transformResponse: (response: ApiSuccess<AuditPage>) => response.data,
      providesTags: ["Audit"],
    }),
  }),
});

export const { useGetAuditQuery } = auditApi;
