import type { Metadata } from "next";
import AssessmentBoard from "@/components/assessment/AssessmentBoard";

export const metadata: Metadata = {
  title: "Assessment · YESE",
};

export default function AssessmentPage() {
  return <AssessmentBoard />;
}
