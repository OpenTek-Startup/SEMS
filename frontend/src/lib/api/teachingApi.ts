import { baseApi, type ApiSuccess } from "./baseApi";

/** A teacher as shown in a cell or a picker. */
export interface TeacherRef {
  id: string;
  staffNumber: string;
  /** "Ngwa Brenda" */
  fullName: string;
  /** false when the teacher has left since being assigned */
  active: boolean;
}

export interface TeacherOption extends TeacherRef {
  position: string;
  /** how many (section, subject) pairs this teacher has in the year */
  load: number;
}

export interface AssignmentCell {
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
  teacher: TeacherRef | null;
}

export interface SectionAssignments {
  sectionId: string;
  classId: string;
  /** "Form 1 A" */
  label: string;
  cells: AssignmentCell[];
  assigned: number;
}

export interface AssignmentGrid {
  year: { id: string; name: string } | null;
  sections: SectionAssignments[];
  total: number;
  assigned: number;
}

export interface MyClass {
  sectionId: string;
  classId: string;
  label: string;
  subjectId: string;
  code: string;
  name: string;
  coefficient: number;
}

export interface MyTeaching {
  year: { id: string; name: string } | null;
  staff: TeacherRef | null;
  classes: MyClass[];
}

export interface AssignmentInput {
  yearId?: string;
  sectionId: string;
  subjectId: string;
  /** null removes the teacher */
  staffMemberId: string | null;
}

const teachingBase = baseApi.enhanceEndpoints({ addTagTypes: ["Teaching", "Academic", "Staff"] });
const unwrap = <T,>(response: ApiSuccess<T>) => response.data;
const withYear = (path: string, yearId?: string) => (yearId ? `${path}?yearId=${encodeURIComponent(yearId)}` : path);

/**
 * Teacher assignment (needs the Academic and Staff modules). The lists also
 * listen to the Academic and Staff tags: a new section, a class subject or a
 * teacher who leaves changes the grid.
 */
export const teachingApi = teachingBase.injectEndpoints({
  endpoints: (build) => ({
    getAssignments: build.query<AssignmentGrid, string | undefined>({
      query: (yearId) => withYear("/teaching/assignments", yearId),
      transformResponse: unwrap<AssignmentGrid>,
      providesTags: ["Teaching", "Academic", "Staff"],
    }),
    getTeachers: build.query<TeacherOption[], string | undefined>({
      query: (yearId) => withYear("/teaching/teachers", yearId),
      transformResponse: unwrap<TeacherOption[]>,
      providesTags: ["Teaching", "Staff"],
    }),
    getMyTeaching: build.query<MyTeaching, void>({
      query: () => "/teaching/mine",
      transformResponse: unwrap<MyTeaching>,
      providesTags: ["Teaching", "Academic", "Staff"],
    }),
    setAssignment: build.mutation<{ teacher: TeacherRef | null }, AssignmentInput>({
      query: (body) => ({ url: "/teaching/assignments", method: "PUT", body }),
      transformResponse: unwrap<{ teacher: TeacherRef | null }>,
      invalidatesTags: ["Teaching"],
    }),
  }),
});

export const { useGetAssignmentsQuery, useGetTeachersQuery, useGetMyTeachingQuery, useSetAssignmentMutation } =
  teachingApi;
