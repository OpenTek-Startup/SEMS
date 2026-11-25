import { baseApi, type ApiSuccess } from "./baseApi";

export type AssessmentStatus = "open" | "submitted" | "validated" | "locked";
export type AssessmentAction = "submit" | "validate" | "reopen" | "lock";

export interface Assessment {
  id: string;
  yearId: string;
  term: { id: string; name: string };
  section: { id: string; label: string };
  subject: { id: string; code: string; name: string };
  name: string;
  maxScore: number;
  weight: number;
  /** "2026-10-12" or null */
  heldOn: string | null;
  status: AssessmentStatus;
  submittedAt: string | null;
  validatedAt: string | null;
  lockedAt: string | null;
}

export interface AssessmentFilter {
  yearId?: string;
  termId?: string;
  sectionId?: string;
  subjectId?: string;
  status?: AssessmentStatus;
}

export interface AssessmentInput {
  termId: string;
  sectionId: string;
  subjectId: string;
  name: string;
  maxScore: number;
  weight: number;
  heldOn: string | null;
}

export interface SheetLine {
  studentId: string;
  matricule: string;
  fullName: string;
  gender: string;
  score: number | null;
  absent: boolean;
  /** false: has a mark here but left the section */
  inSection: boolean;
}

export interface MarkSheet {
  assessment: Assessment;
  students: SheetLine[];
  summary: {
    students: number;
    marked: number;
    absent: number;
    missing: number;
    average: number | null;
    highest: number | null;
    lowest: number | null;
    passed: number;
  };
  /** open: type marks; override: locked, a reason is needed; closed: waiting for validation */
  editing: "open" | "override" | "closed";
}

export type AssessmentChanges = Partial<Pick<AssessmentInput, "name" | "maxScore" | "weight" | "heldOn">>;

const assessmentBase = baseApi.enhanceEndpoints({ addTagTypes: ["Assessment", "Teaching", "Academic"] });
const unwrap = <T,>(response: ApiSuccess<T>) => response.data;

function listUrl(filter: AssessmentFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `/assessments?${text}` : "/assessments";
}

/** Assessments (module "assessment") and their workflow. */
export const assessmentApi = assessmentBase.injectEndpoints({
  endpoints: (build) => ({
    getAssessments: build.query<Assessment[], AssessmentFilter>({
      query: listUrl,
      transformResponse: unwrap<Assessment[]>,
      // A new teacher assignment changes what a teacher sees.
      providesTags: ["Assessment", "Teaching", "Academic"],
    }),
    createAssessment: build.mutation<Assessment, AssessmentInput>({
      query: (body) => ({ url: "/assessments", method: "POST", body }),
      transformResponse: unwrap<Assessment>,
      invalidatesTags: ["Assessment"],
    }),
    updateAssessment: build.mutation<Assessment, { id: string; body: AssessmentChanges }>({
      query: ({ id, body }) => ({ url: `/assessments/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<Assessment>,
      invalidatesTags: ["Assessment"],
    }),
    deleteAssessment: build.mutation<{ id: string; deleted: true }, string>({
      query: (id) => ({ url: `/assessments/${id}`, method: "DELETE" }),
      transformResponse: unwrap<{ id: string; deleted: true }>,
      invalidatesTags: ["Assessment"],
    }),
    getMarkSheet: build.query<MarkSheet, string>({
      query: (id) => `/assessments/${id}/marks`,
      transformResponse: unwrap<MarkSheet>,
      providesTags: ["Assessment"],
    }),
    saveMarks: build.mutation<
      MarkSheet,
      { id: string; marks: { studentId: string; value: string | null }[]; reason?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/assessments/${id}/marks`, method: "PUT", body }),
      transformResponse: unwrap<MarkSheet>,
      invalidatesTags: ["Assessment"],
    }),
    moveAssessment: build.mutation<Assessment, { id: string; action: AssessmentAction }>({
      query: ({ id, action }) => ({ url: `/assessments/${id}/${action}`, method: "POST" }),
      transformResponse: unwrap<Assessment>,
      invalidatesTags: ["Assessment"],
    }),
  }),
});

export const {
  useGetAssessmentsQuery,
  useCreateAssessmentMutation,
  useUpdateAssessmentMutation,
  useDeleteAssessmentMutation,
  useMoveAssessmentMutation,
  useGetMarkSheetQuery,
  useSaveMarksMutation,
} = assessmentApi;
