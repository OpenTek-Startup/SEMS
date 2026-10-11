import type { Metadata } from "next";
import ChangePasswordForm from "@/components/auth/ChangePasswordForm";

export const metadata: Metadata = {
  title: "Change password · YESE",
};

export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
