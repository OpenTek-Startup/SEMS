import { baseApi, type ApiSuccess } from "./baseApi";

export interface StatusCounts {
  total: number;
  open: number;
  submitted: number;
  validated: number;
  locked: number;
}

/** Figures of the school dashboard; a part is null when its module is off or the user may not see it. */
export interface DashboardView {
  year: { id: string; name: string } | null;
  term: { id: string; name: string; current: boolean } | null;
  students: { enrolled: number; girls: number; boys: number; withoutClass: number; sections: number } | null;
  staff: { active: number; teaching: number } | null;
  teaching: { places: number; assigned: number } | null;
  assessments: {
    scope: "school" | "mine";
    overall: StatusCounts;
    byClass: (StatusCounts & { classId: string; name: string })[];
  } | null;
  results: { sections: number; published: number } | null;
}

const dashboardBase = baseApi.enhanceEndpoints({
  addTagTypes: ["Students", "Enrollment", "Staff", "Teaching", "Assessment", "Publication", "Academic"],
});

export const dashboardApi = dashboardBase.injectEndpoints({
  endpoints: (build) => ({
    getDashboard: build.query<DashboardView, void>({
      query: () => "/dashboard",
      transformResponse: (response: ApiSuccess<DashboardView>) => response.data,
      // Any change in these modules refreshes the figures.
      providesTags: ["Students", "Enrollment", "Staff", "Teaching", "Assessment", "Publication", "Academic"],
    }),
  }),
});

export const { useGetDashboardQuery } = dashboardApi;
