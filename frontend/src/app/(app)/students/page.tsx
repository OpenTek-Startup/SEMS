import type { Metadata } from "next";
import StudentDirectory from "@/components/students/StudentDirectory";

export const metadata: Metadata = {
  title: "Students · YESE",
};

export default function StudentsPage() {
  return <StudentDirectory />;
}
