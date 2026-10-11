// Mirrors the backend rules (backend/src/core/auth/auth-rules.ts, passwordProblems)
// so users see what is missing while typing. The backend still decides.

export interface PasswordRule {
  label: string;
  ok: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "At least one letter", ok: /[A-Za-z]/.test(password) },
    { label: "At least one number", ok: /\d/.test(password) },
  ];
}
