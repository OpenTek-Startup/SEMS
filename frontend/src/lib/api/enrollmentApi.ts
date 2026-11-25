import { baseApi, type ApiSuccess } from "./baseApi";

export type EnrollmentStatus = "active" | "transferred" | "withdrawn";

export interface Enrollment {
  id: string;
  yearId: string;
  status: EnrollmentStatus;
  enrolledOn: string;
  leftOn: string | null;
  reason: string | null;
  section: { id: string; label: string };
  student: { id: string; matricule: string; fullName: string; gender: string };
}

export interface SectionCount {
  sectionId: string;
  classId: string;
  label: string;
  capacity: number | null;
  enrolled: number;
  boys: number;
  girls: number;
}

export interface SectionOverview {
  year: { id: string; name: string } | null;
  sections: SectionCount[];
}

const enrollmentBase = baseApi.enhanceEndpoints({ addTagTypes: ["Enrollment", "Students", "Academic"] });
const unwrap = <T,>(response: ApiSuccess<T>) => response.data;

/** Enrollment (module "enrollment"): students in sections of the current year. */
export const enrollmentApi = enrollmentBase.injectEndpoints({
  endpoints: (build) => ({
    getSectionOverview: build.query<SectionOverview, void>({
      query: () => "/enrollment/sections",
      transformResponse: unwrap<SectionOverview>,
      providesTags: ["Enrollment", "Academic"],
    }),
    getEnrollments: build.query<Enrollment[], { sectionId?: string; status?: EnrollmentStatus }>({
      query: ({ sectionId, status }) => {
        const params = new URLSearchParams();
        if (sectionId) params.set("sectionId", sectionId);
        if (status) params.set("status", status);
        const text = params.toString();
        return text ? `/enrollment?${text}` : "/enrollment";
      },
      transformResponse: unwrap<Enrollment[]>,
      providesTags: ["Enrollment", "Students"],
    }),
    enroll: build.mutation<Enrollment[], { sectionId: string; studentIds: string[]; enrolledOn?: string }>({
      query: (body) => ({ url: "/enrollment", method: "POST", body }),
      transformResponse: unwrap<Enrollment[]>,
      invalidatesTags: ["Enrollment"],
    }),
    transfer: build.mutation<Enrollment, { id: string; sectionId: string; on?: string }>({
      query: ({ id, ...body }) => ({ url: `/enrollment/${id}/transfer`, method: "POST", body }),
      transformResponse: unwrap<Enrollment>,
      invalidatesTags: ["Enrollment"],
    }),
    withdraw: build.mutation<Enrollment, { id: string; on?: string; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/enrollment/${id}/withdraw`, method: "POST", body }),
      transformResponse: unwrap<Enrollment>,
      invalidatesTags: ["Enrollment"],
    }),
  }),
});

export const {
  useGetSectionOverviewQuery,
  useGetEnrollmentsQuery,
  useEnrollMutation,
  useTransferMutation,
  useWithdrawMutation,
} = enrollmentApi;
