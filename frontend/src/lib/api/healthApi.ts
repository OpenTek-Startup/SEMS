import { baseApi, type ApiSuccess } from "./baseApi";

export interface HealthStatus {
  status: "ok";
  service: string;
  database: "connected";
  timestamp: string;
}

export interface CurrentTenant {
  id: string;
  slug: string;
  name: string;
  type: "primary" | "secondary" | "university";
}

export const healthApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHealth: build.query<HealthStatus, void>({
      query: () => "/health",
      transformResponse: (response: ApiSuccess<HealthStatus>) => response.data,
    }),
    getCurrentTenant: build.query<CurrentTenant, void>({
      query: () => "/tenant/current",
      transformResponse: (response: ApiSuccess<CurrentTenant>) => response.data,
    }),
  }),
});

export const { useGetHealthQuery, useGetCurrentTenantQuery } = healthApi;
