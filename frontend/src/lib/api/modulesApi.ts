import { baseApi, type ApiSuccess } from "./baseApi";

/** A module as the current school sees it (GET /modules). */
export interface SchoolModule {
  code: string;
  name: string;
  category: string;
  description: string | null;
  dependsOn: string[];
  core: boolean;
  active: boolean;
}

/** A catalogue entry (Super Admin). */
export interface CatalogueModule {
  code: string;
  name: string;
  category: string;
  description: string | null;
  dependsOn: string[];
}

/** A school with its active module codes (Super Admin). */
export interface PlatformSchool {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  activeModules: string[];
}

export type InstitutionType = "primary" | "secondary" | "university";

export interface CreateSchoolRequest {
  name: string;
  slug: string;
  type: InstitutionType;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
}

/** Returned once after creating a school: the first administrator's one-time password. */
export interface CreatedSchool {
  school: PlatformSchool;
  admin: { email: string; firstName: string; lastName: string };
  temporaryPassword: string;
}

const modulesBase = baseApi.enhanceEndpoints({ addTagTypes: ["Modules", "Schools"] });

export const modulesApi = modulesBase.injectEndpoints({
  endpoints: (build) => ({
    getSchoolModules: build.query<SchoolModule[], void>({
      query: () => "/modules",
      transformResponse: (response: ApiSuccess<SchoolModule[]>) => response.data,
      providesTags: ["Modules"],
    }),
    getCatalogue: build.query<CatalogueModule[], void>({
      query: () => "/platform/modules",
      transformResponse: (response: ApiSuccess<CatalogueModule[]>) => response.data,
    }),
    getPlatformSchools: build.query<PlatformSchool[], void>({
      query: () => "/platform/schools",
      transformResponse: (response: ApiSuccess<PlatformSchool[]>) => response.data,
      providesTags: ["Schools"],
    }),
    setSchoolModule: build.mutation<PlatformSchool, { schoolId: string; code: string; active: boolean }>({
      query: ({ schoolId, code, active }) => ({
        url: `/platform/schools/${schoolId}/modules/${code}`,
        method: "PUT",
        body: { active },
      }),
      transformResponse: (response: ApiSuccess<PlatformSchool>) => response.data,
      invalidatesTags: ["Schools", "Modules"],
    }),
    createSchool: build.mutation<CreatedSchool, CreateSchoolRequest>({
      query: (body) => ({ url: "/platform/schools", method: "POST", body }),
      transformResponse: (response: ApiSuccess<CreatedSchool>) => response.data,
      invalidatesTags: ["Schools"],
    }),
    setSchoolStatus: build.mutation<PlatformSchool, { schoolId: string; status: "active" | "suspended" }>({
      query: ({ schoolId, status }) => ({
        url: `/platform/schools/${schoolId}/status`,
        method: "PATCH",
        body: { status },
      }),
      transformResponse: (response: ApiSuccess<PlatformSchool>) => response.data,
      invalidatesTags: ["Schools"],
    }),
  }),
});

export const {
  useGetSchoolModulesQuery,
  useGetCatalogueQuery,
  useGetPlatformSchoolsQuery,
  useSetSchoolModuleMutation,
  useCreateSchoolMutation,
  useSetSchoolStatusMutation,
} = modulesApi;
