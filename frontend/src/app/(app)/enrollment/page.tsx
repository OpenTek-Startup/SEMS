import type { Metadata } from "next";
import EnrollmentBoard from "@/components/enrollment/EnrollmentBoard";

export const metadata: Metadata = {
  title: "Classes · YESE",
};

export default function EnrollmentPage() {
  return <EnrollmentBoard />;
}
