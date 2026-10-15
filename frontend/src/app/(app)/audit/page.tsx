import type { Metadata } from "next";
import AuditLog from "@/components/audit/AuditLog";

export const metadata: Metadata = {
  title: "Audit log · YESE",
};

export default function AuditPage() {
  return <AuditLog />;
}
