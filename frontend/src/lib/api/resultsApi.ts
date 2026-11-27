import { baseApi, type ApiSuccess } from "./baseApi";

export interface SubjectLine {
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
  teacher: string | null;
  average: number | null;
  points: number | null;
  rank: number | null;
  appreciation: string | null;
}

export interface StudentResult {
  student: { studentId: string; matricule: string; fullName: string };
  subjects: SubjectLine[];
  totalCoefficient: number;
  totalPoints: number;
  average: number | null;
  rank: number | null;
  passed: boolean;
  appreciation: string | null;
}

export interface ClassStats {
  size: number;
  classified: number;
  classAverage: number | null;
  highest: number | null;
  lowest: number | null;
  passed: number;
  passRate: number | null;
}

export interface SectionResults {
  year: { id: string; name: string };
  term: { id: string; name: string };
  section: { id: string; label: string };
  provisional: boolean;
  counted: { id: string; subjectId: string; name: string; status: string }[];
  pending: number;
  results: {
    students: StudentResult[];
    subjects: { subjectId: string; code: string; name: string; classAverage: number | null; highest: number | null; lowest: number | null }[];
    stats: ClassStats;
  };
  /** null: not published */
  publication: PublicationInfo | null;
  /** students whose average or rank would change if republished now */
  changesSincePublication: ResultChange[];
}

export interface PublicationInfo {
  version: number;
  publishedAt: string;
  publishedBy: string;
}

export interface ResultChange {
  studentId: string;
  fullName: string;
  before: { average: number | null; rank: number | null } | null;
  after: { average: number | null; rank: number | null } | null;
}

export interface AnnualResults {
  year: { id: string; name: string };
  section: { id: string; label: string };
  terms: { termId: string; name: string; published: boolean }[];
  students: {
    student: { studentId: string; matricule: string; fullName: string };
    terms: { termId: string; average: number | null; rank: number | null }[];
    average: number | null;
    rank: number | null;
    decision: "promoted" | "repeat" | null;
    appreciation: string | null;
  }[];
  stats: { size: number; classified: number; classAverage: number | null; promoted: number; repeat: number };
}

/** The school's figures for a term (GET /results/summary). */
export interface TermSummary {
  term: { id: string; name: string };
  classes: {
    sectionId: string;
    label: string;
    state: "published" | "final" | "in_progress";
    size: number;
    classified: number;
    classAverage: number | null;
    passed: number;
    passRate: number | null;
  }[];
  subjects: {
    subjectId: string;
    code: string;
    name: string;
    graded: number;
    passed: number;
    passRate: number | null;
    average: number | null;
    byClass: Record<string, number | null>;
  }[];
  totals: { size: number; classified: number; passed: number; passRate: number | null; average: number | null };
}

export interface PublicationOverview {
  term: { id: string; name: string };
  sections: { sectionId: string; label: string; publication: PublicationInfo | null }[];
}

const resultsBase = baseApi.enhanceEndpoints({ addTagTypes: ["Assessment", "Enrollment", "Academic", "Publication"] });

/** Results (module "results"), computed by the backend from the marks. */
export const resultsApi = resultsBase.injectEndpoints({
  endpoints: (build) => ({
    getResults: build.query<SectionResults, { termId: string; sectionId: string; provisional: boolean }>({
      query: ({ termId, sectionId, provisional }) =>
        `/results?termId=${termId}&sectionId=${sectionId}${provisional ? "&provisional=true" : ""}`,
      transformResponse: (response: ApiSuccess<SectionResults>) => response.data,
      providesTags: ["Assessment", "Enrollment", "Academic", "Publication"],
    }),
    getSummary: build.query<TermSummary, string>({
      query: (termId) => `/results/summary?termId=${termId}`,
      transformResponse: (response: ApiSuccess<TermSummary>) => response.data,
      providesTags: ["Assessment", "Enrollment", "Academic", "Publication"],
    }),
    getAnnual: build.query<AnnualResults, string>({
      query: (sectionId) => `/results/annual?sectionId=${sectionId}`,
      transformResponse: (response: ApiSuccess<AnnualResults>) => response.data,
      providesTags: ["Assessment", "Enrollment", "Academic", "Publication"],
    }),
    getPublications: build.query<PublicationOverview, string>({
      query: (termId) => `/results/publications?termId=${termId}`,
      transformResponse: (response: ApiSuccess<PublicationOverview>) => response.data,
      providesTags: ["Publication", "Academic"],
    }),
    publishResults: build.mutation<SectionResults, { termId: string; sectionId: string }>({
      query: (body) => ({ url: "/results/publish", method: "POST", body }),
      transformResponse: (response: ApiSuccess<SectionResults>) => response.data,
      invalidatesTags: ["Publication"],
    }),
    unpublishResults: build.mutation<SectionResults, { termId: string; sectionId: string; reason: string }>({
      query: (body) => ({ url: "/results/unpublish", method: "POST", body }),
      transformResponse: (response: ApiSuccess<SectionResults>) => response.data,
      invalidatesTags: ["Publication"],
    }),
  }),
});

export const {
  useGetResultsQuery,
  useGetAnnualQuery,
  useGetSummaryQuery,
  useGetPublicationsQuery,
  usePublishResultsMutation,
  useUnpublishResultsMutation,
} = resultsApi;
