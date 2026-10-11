import type { Metadata } from "next";
import Dashboard from "@/components/auth/Dashboard";

export const metadata: Metadata = {
  title: "Dashboard · YESE",
};

export default function DashboardPage() {
  return <Dashboard />;
}
