import type { ReactNode } from "react";
import AuthGate from "@/components/auth/AuthGate";
import AppShell from "@/components/layout/AppShell";

// Every page in the (app) group needs a signed-in user, and shares the side menu and top bar.
// The folder name in brackets does not appear in the URL: (app)/dashboard -> /dashboard.
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
