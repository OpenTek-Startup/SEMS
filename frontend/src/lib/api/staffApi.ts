import { baseApi, type ApiSuccess } from "./baseApi";

export type StaffCategory = "teaching" | "non_teaching";
export type StaffStatus = "active" | "inactive";

export interface StaffMember {
  id: string;
  staffNumber: string;
  firstName: string;
  lastName: string;
  /** "Ngwa Brenda" (last name first) */
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string;
  category: StaffCategory;
  status: StaffStatus;
  /** "2019-09-02" or null */
  hireDate: string | null;
  account: { id: string; email: string; status: string } | null;
}

/** A user account not yet linked to a staff record. */
export interface LinkableAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface StaffFilter {
  search?: string;
  status?: StaffStatus;
  category?: StaffCategory;
}

export interface StaffInput {
  staffNumber?: string;
  firstName: string;
  lastName: string;
  position: string;
  category: StaffCategory;
  email: string | null;
  phone: string | null;
  hireDate: string | null;
  userId?: string | null;
}

const staffBase = baseApi.enhanceEndpoints({ addTagTypes: ["Staff", "StaffAccounts"] });

function query(filter: StaffFilter): string {
  const params = new URLSearchParams();
  if (filter.search?.trim()) params.set("search", filter.search.trim());
  if (filter.status) params.set("status", filter.status);
  if (filter.category) params.set("category", filter.category);
  const text = params.toString();
  return text ? `/staff?${text}` : "/staff";
}

export const staffApi = staffBase.injectEndpoints({
  endpoints: (build) => ({
    getStaff: build.query<StaffMember[], StaffFilter>({
      query,
      transformResponse: (response: ApiSuccess<StaffMember[]>) => response.data,
      providesTags: ["Staff"],
    }),
    getLinkableAccounts: build.query<LinkableAccount[], void>({
      query: () => "/staff/accounts",
      transformResponse: (response: ApiSuccess<LinkableAccount[]>) => response.data,
      providesTags: ["StaffAccounts"],
    }),
    createStaff: build.mutation<StaffMember, StaffInput>({
      query: (body) => ({ url: "/staff", method: "POST", body }),
      transformResponse: (response: ApiSuccess<StaffMember>) => response.data,
      invalidatesTags: ["Staff", "StaffAccounts"],
    }),
    updateStaff: build.mutation<StaffMember, { id: string; body: Partial<Omit<StaffInput, "userId">> }>({
      query: ({ id, body }) => ({ url: `/staff/${id}`, method: "PATCH", body }),
      transformResponse: (response: ApiSuccess<StaffMember>) => response.data,
      invalidatesTags: ["Staff"],
    }),
    setStaffStatus: build.mutation<StaffMember, { id: string; status: StaffStatus }>({
      query: ({ id, status }) => ({ url: `/staff/${id}/status`, method: "PATCH", body: { status } }),
      transformResponse: (response: ApiSuccess<StaffMember>) => response.data,
      invalidatesTags: ["Staff"],
    }),
    linkStaffAccount: build.mutation<StaffMember, { id: string; userId: string | null }>({
      query: ({ id, userId }) => ({ url: `/staff/${id}/account`, method: "PUT", body: { userId } }),
      transformResponse: (response: ApiSuccess<StaffMember>) => response.data,
      invalidatesTags: ["Staff", "StaffAccounts"],
    }),
  }),
});

export const {
  useGetStaffQuery,
  useGetLinkableAccountsQuery,
  useCreateStaffMutation,
  useUpdateStaffMutation,
  useSetStaffStatusMutation,
  useLinkStaffAccountMutation,
} = staffApi;
