import type { Metadata } from "next";
import UsersAdmin from "@/components/users/UsersAdmin";

export const metadata: Metadata = {
  title: "Users · YESE",
};

export default function UsersPage() {
  return <UsersAdmin />;
}
