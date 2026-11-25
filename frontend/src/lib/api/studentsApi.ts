import { baseApi, type ApiSuccess } from "./baseApi";

export type Gender = "male" | "female";
export type StudentStatus = "active" | "inactive";

export interface Student {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  /** "Abena Ada" (last name first) */
  fullName: string;
  gender: Gender;
  /** "2014-03-02" or null */
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  guardian: { name: string | null; phone: string | null; relationship: string | null } | null;
  status: StudentStatus;
  admittedOn: string | null;
  /** class in the current year */
  current: { enrollmentId: string; yearId: string; sectionId: string; label: string } | null;
}

export interface StudentDetail extends Student {
  enrollments: {
    id: string;
    year: { id: string; name: string };
    section: { id: string; label: string };
    status: string;
    enrolledOn: string;
    leftOn: string | null;
    reason: string | null;
  }[];
}

export interface StudentFilter {
  search?: string;
  status?: StudentStatus;
  sectionId?: string;
  /** only active students with no class in the current year */
  unplaced?: boolean;
}

export interface StudentInput {
  matricule?: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelationship: string | null;
  admittedOn: string | null;
}

const studentsBase = baseApi.enhanceEndpoints({ addTagTypes: ["Students", "Enrollment"] });
const unwrap = <T,>(response: ApiSuccess<T>) => response.data;

function listUrl(filter: StudentFilter): string {
  const params = new URLSearchParams();
  if (filter.search?.trim()) params.set("search", filter.search.trim());
  if (filter.status) params.set("status", filter.status);
  if (filter.sectionId) params.set("sectionId", filter.sectionId);
  if (filter.unplaced) params.set("unplaced", "true");
  const text = params.toString();
  return text ? `/students?${text}` : "/students";
}

/** Student records (module "student"). Enrollment changes refresh the lists too (the "current class" column). */
export const studentsApi = studentsBase.injectEndpoints({
  endpoints: (build) => ({
    getStudents: build.query<Student[], StudentFilter>({
      query: listUrl,
      transformResponse: unwrap<Student[]>,
      providesTags: ["Students", "Enrollment"],
    }),
    getStudent: build.query<StudentDetail, string>({
      query: (id) => `/students/${id}`,
      transformResponse: unwrap<StudentDetail>,
      providesTags: ["Students", "Enrollment"],
    }),
    createStudent: build.mutation<StudentDetail, StudentInput>({
      query: (body) => ({ url: "/students", method: "POST", body }),
      transformResponse: unwrap<StudentDetail>,
      invalidatesTags: ["Students"],
    }),
    updateStudent: build.mutation<StudentDetail, { id: string; body: Partial<StudentInput> }>({
      query: ({ id, body }) => ({ url: `/students/${id}`, method: "PATCH", body }),
      transformResponse: unwrap<StudentDetail>,
      invalidatesTags: ["Students"],
    }),
    setStudentStatus: build.mutation<StudentDetail, { id: string; status: StudentStatus }>({
      query: ({ id, status }) => ({ url: `/students/${id}/status`, method: "PATCH", body: { status } }),
      transformResponse: unwrap<StudentDetail>,
      invalidatesTags: ["Students"],
    }),
  }),
});

export const {
  useGetStudentsQuery,
  useGetStudentQuery,
  useCreateStudentMutation,
  useUpdateStudentMutation,
  useSetStudentStatusMutation,
} = studentsApi;
