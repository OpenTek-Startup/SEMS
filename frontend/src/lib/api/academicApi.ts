import { baseApi, type ApiSuccess } from "./baseApi";

/** Dates are calendar days as text: "2026-09-07". */
export interface Term {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** today falls inside this term of the current year */
  isCurrent: boolean;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  terms: Term[];
}

export interface CurrentPeriod {
  year: Omit<AcademicYear, "isCurrent" | "terms"> | null;
  term: Omit<Term, "isCurrent"> | null;
}

export interface Section {
  id: string;
  name: string;
  /** e.g. "Form 1 A" */
  label: string;
  capacity: number | null;
}

export interface ClassSubject {
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
}

export interface SchoolClass {
  id: string;
  name: string;
  level: number;
  sections: Section[];
  subjects: ClassSubject[];
  totalCoefficient: number;
}

/** Flat section list for pickers (GET /academic/sections). */
export interface SectionListItem extends Section {
  classId: string;
  className: string;
  level: number;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  classCount: number;
}

export interface DatedInput {
  name: string;
  startDate: string;
  endDate: string;
}

const academicBase = baseApi.enhanceEndpoints({ addTagTypes: ["Academic"] });
const unwrap = <T,>(response: ApiSuccess<T>) => response.data;

/**
 * Academic structure (module "academic"). One cache tag: any change
 * refetches the lists, which stay small (a few years, classes, subjects).
 */
export const academicApi = academicBase.injectEndpoints({
  endpoints: (build) => ({
    getCurrentPeriod: build.query<CurrentPeriod, void>({
      query: () => "/academic/current",
      transformResponse: unwrap<CurrentPeriod>,
      providesTags: ["Academic"],
    }),
    getYears: build.query<AcademicYear[], void>({
      query: () => "/academic/years",
      transformResponse: unwrap<AcademicYear[]>,
      providesTags: ["Academic"],
    }),
    getClasses: build.query<SchoolClass[], void>({
      query: () => "/academic/classes",
      transformResponse: unwrap<SchoolClass[]>,
      providesTags: ["Academic"],
    }),
    getSections: build.query<SectionListItem[], void>({
      query: () => "/academic/sections",
      transformResponse: unwrap<SectionListItem[]>,
      providesTags: ["Academic"],
    }),
    getSubjects: build.query<Subject[], void>({
      query: () => "/academic/subjects",
      transformResponse: unwrap<Subject[]>,
      providesTags: ["Academic"],
    }),

    createYear: build.mutation<AcademicYear, DatedInput>({
      query: (body) => ({ url: "/academic/years", method: "POST", body }),
      transformResponse: unwrap<AcademicYear>,
      invalidatesTags: ["Academic"],
    }),
    updateYear: build.mutation<AcademicYear, { id: string } & Partial<DatedInput>>({
      query: ({ id, ...body }) => ({ url: `/academic/years/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<AcademicYear>,
      invalidatesTags: ["Academic"],
    }),
    setCurrentYear: build.mutation<AcademicYear, { id: string }>({
      query: ({ id }) => ({ url: `/academic/years/${id}/current`, method: "POST" }),
      transformResponse: unwrap<AcademicYear>,
      invalidatesTags: ["Academic"],
    }),
    deleteYear: build.mutation<{ id: string; deleted: true }, { id: string }>({
      query: ({ id }) => ({ url: `/academic/years/${id}`, method: "DELETE" }),
      transformResponse: unwrap<{ id: string; deleted: true }>,
      invalidatesTags: ["Academic"],
    }),
    createTerm: build.mutation<AcademicYear, { yearId: string } & DatedInput>({
      query: ({ yearId, ...body }) => ({ url: `/academic/years/${yearId}/terms`, method: "POST", body }),
      transformResponse: unwrap<AcademicYear>,
      invalidatesTags: ["Academic"],
    }),
    updateTerm: build.mutation<AcademicYear, { id: string } & Partial<DatedInput>>({
      query: ({ id, ...body }) => ({ url: `/academic/terms/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<AcademicYear>,
      invalidatesTags: ["Academic"],
    }),
    deleteTerm: build.mutation<AcademicYear, { id: string }>({
      query: ({ id }) => ({ url: `/academic/terms/${id}`, method: "DELETE" }),
      transformResponse: unwrap<AcademicYear>,
      invalidatesTags: ["Academic"],
    }),

    createClass: build.mutation<SchoolClass, { name: string; level: number }>({
      query: (body) => ({ url: "/academic/classes", method: "POST", body }),
      transformResponse: unwrap<SchoolClass>,
      invalidatesTags: ["Academic"],
    }),
    updateClass: build.mutation<SchoolClass, { id: string; name?: string; level?: number }>({
      query: ({ id, ...body }) => ({ url: `/academic/classes/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<SchoolClass>,
      invalidatesTags: ["Academic"],
    }),
    deleteClass: build.mutation<{ id: string; deleted: true }, { id: string }>({
      query: ({ id }) => ({ url: `/academic/classes/${id}`, method: "DELETE" }),
      transformResponse: unwrap<{ id: string; deleted: true }>,
      invalidatesTags: ["Academic"],
    }),
    setClassSubjects: build.mutation<
      SchoolClass,
      { classId: string; subjects: { subjectId: string; coefficient: number }[] }
    >({
      query: ({ classId, subjects }) => ({
        url: `/academic/classes/${classId}/subjects`,
        method: "PUT",
        body: { subjects },
      }),
      transformResponse: unwrap<SchoolClass>,
      invalidatesTags: ["Academic"],
    }),
    createSection: build.mutation<SchoolClass, { classId: string; name: string; capacity?: number | null }>({
      query: ({ classId, ...body }) => ({ url: `/academic/classes/${classId}/sections`, method: "POST", body }),
      transformResponse: unwrap<SchoolClass>,
      invalidatesTags: ["Academic"],
    }),
    updateSection: build.mutation<SchoolClass, { id: string; name?: string; capacity?: number | null }>({
      query: ({ id, ...body }) => ({ url: `/academic/sections/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<SchoolClass>,
      invalidatesTags: ["Academic"],
    }),
    deleteSection: build.mutation<SchoolClass, { id: string }>({
      query: ({ id }) => ({ url: `/academic/sections/${id}`, method: "DELETE" }),
      transformResponse: unwrap<SchoolClass>,
      invalidatesTags: ["Academic"],
    }),

    createSubject: build.mutation<Subject, { code: string; name: string }>({
      query: (body) => ({ url: "/academic/subjects", method: "POST", body }),
      transformResponse: unwrap<Subject>,
      invalidatesTags: ["Academic"],
    }),
    updateSubject: build.mutation<Subject, { id: string; code?: string; name?: string }>({
      query: ({ id, ...body }) => ({ url: `/academic/subjects/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<Subject>,
      invalidatesTags: ["Academic"],
    }),
    deleteSubject: build.mutation<{ id: string; deleted: true }, { id: string }>({
      query: ({ id }) => ({ url: `/academic/subjects/${id}`, method: "DELETE" }),
      transformResponse: unwrap<{ id: string; deleted: true }>,
      invalidatesTags: ["Academic"],
    }),
  }),
});

export const {
  useGetCurrentPeriodQuery,
  useGetYearsQuery,
  useGetClassesQuery,
  useGetSectionsQuery,
  useGetSubjectsQuery,
  useCreateYearMutation,
  useUpdateYearMutation,
  useSetCurrentYearMutation,
  useDeleteYearMutation,
  useCreateTermMutation,
  useUpdateTermMutation,
  useDeleteTermMutation,
  useCreateClassMutation,
  useUpdateClassMutation,
  useDeleteClassMutation,
  useSetClassSubjectsMutation,
  useCreateSectionMutation,
  useUpdateSectionMutation,
  useDeleteSectionMutation,
  useCreateSubjectMutation,
  useUpdateSubjectMutation,
  useDeleteSubjectMutation,
} = academicApi;
