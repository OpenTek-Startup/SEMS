import type { ReactNode } from "react";
import AuthGate from "@/components/auth/AuthGate";

// Every page in the (app) group needs a signed-in user.
// The folder name in brackets does not appear in the URL: (app)/dashboard -> /dashboard.
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
