import type { Metadata } from "next";
import AcademicSetup from "@/components/academic/AcademicSetup";

export const metadata: Metadata = {
  title: "Academic structure · YESE",
};

export default function AcademicPage() {
  return <AcademicSetup />;
}
