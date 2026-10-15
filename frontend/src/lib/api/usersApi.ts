import { baseApi, type ApiSuccess } from "./baseApi";
import type { RoleArchetype } from "@/lib/auth/types";

export interface SchoolUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; name: string; archetype: RoleArchetype | null }[];
}

export interface SchoolRole {
  id: string;
  name: string;
  description: string | null;
  archetype: RoleArchetype | null;
  isSystem: boolean;
  permissions: string[];
}

/** Returned once after creating a user or resetting a password. */
export interface UserWithTemporaryPassword {
  user: SchoolUser;
  temporaryPassword: string;
}

export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  roleIds: string[];
}

const usersBase = baseApi.enhanceEndpoints({ addTagTypes: ["User", "Role"] });

export const usersApi = usersBase.injectEndpoints({
  endpoints: (build) => ({
    getUsers: build.query<SchoolUser[], void>({
      query: () => "/users",
      transformResponse: (response: ApiSuccess<SchoolUser[]>) => response.data,
      providesTags: ["User"],
    }),
    getRoles: build.query<SchoolRole[], void>({
      query: () => "/roles",
      transformResponse: (response: ApiSuccess<SchoolRole[]>) => response.data,
      providesTags: ["Role"],
    }),
    createUser: build.mutation<UserWithTemporaryPassword, CreateUserRequest>({
      query: (body) => ({ url: "/users", method: "POST", body }),
      transformResponse: (response: ApiSuccess<UserWithTemporaryPassword>) => response.data,
      invalidatesTags: ["User"],
    }),
    setUserStatus: build.mutation<SchoolUser, { id: string; status: "active" | "disabled" }>({
      query: ({ id, status }) => ({ url: `/users/${id}/status`, method: "PATCH", body: { status } }),
      transformResponse: (response: ApiSuccess<SchoolUser>) => response.data,
      invalidatesTags: ["User"],
    }),
    setUserRoles: build.mutation<SchoolUser, { id: string; roleIds: string[] }>({
      query: ({ id, roleIds }) => ({ url: `/users/${id}/roles`, method: "PUT", body: { roleIds } }),
      transformResponse: (response: ApiSuccess<SchoolUser>) => response.data,
      invalidatesTags: ["User"],
    }),
    resetUserPassword: build.mutation<UserWithTemporaryPassword, { id: string }>({
      query: ({ id }) => ({ url: `/users/${id}/reset-password`, method: "POST" }),
      transformResponse: (response: ApiSuccess<UserWithTemporaryPassword>) => response.data,
      invalidatesTags: ["User"],
    }),
  }),
});

export const {
  useGetUsersQuery,
  useGetRolesQuery,
  useCreateUserMutation,
  useSetUserStatusMutation,
  useSetUserRolesMutation,
  useResetUserPasswordMutation,
} = usersApi;
