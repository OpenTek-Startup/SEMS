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
}

const resultsBase = baseApi.enhanceEndpoints({ addTagTypes: ["Assessment", "Enrollment", "Academic"] });

/** Results (module "results"), computed by the backend from the marks. */
export const resultsApi = resultsBase.injectEndpoints({
  endpoints: (build) => ({
    getResults: build.query<SectionResults, { termId: string; sectionId: string; provisional: boolean }>({
      query: ({ termId, sectionId, provisional }) =>
        `/results?termId=${termId}&sectionId=${sectionId}${provisional ? "&provisional=true" : ""}`,
      transformResponse: (response: ApiSuccess<SectionResults>) => response.data,
      providesTags: ["Assessment", "Enrollment", "Academic"],
    }),
  }),
});

export const { useGetResultsQuery } = resultsApi;
