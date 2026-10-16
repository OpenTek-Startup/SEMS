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
  }),
});

export const {
  useGetSchoolModulesQuery,
  useGetCatalogueQuery,
  useGetPlatformSchoolsQuery,
  useSetSchoolModuleMutation,
} = modulesApi;
