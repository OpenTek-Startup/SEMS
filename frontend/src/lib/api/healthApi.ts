import { baseApi, type ApiSuccess } from "./baseApi";

export interface HealthStatus {
  status: "ok";
  service: string;
  database: "connected";
  timestamp: string;
}

export const healthApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHealth: build.query<HealthStatus, void>({
      query: () => "/health",
      transformResponse: (response: ApiSuccess<HealthStatus>) => response.data,
    }),
  }),
});

export const { useGetHealthQuery } = healthApi;
