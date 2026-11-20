import type { Metadata } from "next";
import StaffDirectory from "@/components/staff/StaffDirectory";

export const metadata: Metadata = {
  title: "Staff · YESE",
};

export default function StaffPage() {
  return <StaffDirectory />;
}
