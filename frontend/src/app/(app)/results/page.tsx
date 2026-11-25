import type { Metadata } from "next";
import ResultsBoard from "@/components/results/ResultsBoard";

export const metadata: Metadata = {
  title: "Results · YESE",
};

export default function ResultsPage() {
  return <ResultsBoard />;
}
