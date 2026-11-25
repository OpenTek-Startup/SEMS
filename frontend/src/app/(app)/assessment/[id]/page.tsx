import type { Metadata } from "next";
import MarkSheetPage from "@/components/assessment/MarkSheetPage";

export const metadata: Metadata = {
  title: "Mark sheet · YESE",
};

export default function AssessmentMarksPage() {
  return <MarkSheetPage />;
}
