import type { AuditItem } from "@/lib/api/auditApi";

/** Filter choices shown on the Audit log page. */
export const AUDIT_CATEGORIES = [
  { value: "", label: "All events" },
  { value: "auth.", label: "Sign-in and sessions" },
  { value: "user.", label: "User accounts" },
  { value: "module.", label: "Modules" },
  { value: "academic.", label: "Academic structure" },
] as const;

const SIGN_IN_FAILURE: Record<string, string> = {
  wrong_password: "wrong password",
  unknown_email: "unknown email",
  account_disabled: "account disabled",
};

function targetName(item: AuditItem): string {
  return item.target?.name ?? "a user";
}

function detailText(item: AuditItem, key: string): string {
  const value = item.detail?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * One readable sentence per event, without the actor (shown in its own
 * column). Unknown actions fall back to their code, so nothing is hidden.
 */
export function describeAudit(item: AuditItem): string {
  switch (item.action) {
    case "auth.login.success":
      return "Signed in";
    case "auth.login.failed": {
      const reason = SIGN_IN_FAILURE[detailText(item, "reason")] ?? "refused";
      return `Failed sign-in for ${detailText(item, "email") || "an account"} (${reason})`;
    }
    case "auth.login.blocked":
      return `Sign-in blocked after too many failures (${detailText(item, "email")})`;
    case "auth.logout":
      return "Signed out";
    case "auth.password.changed":
      return "Changed their password";
    case "auth.password.change_failed":
      return "Typed a wrong current password while changing password";
    case "auth.session.idle_timeout":
      return "Signed out automatically after inactivity";
    case "auth.refresh.reused":
      return "Session ended: an old sign-in token was reused";
    case "user.created":
      return `Created the account of ${targetName(item)}`;
    case "user.disabled":
      return `Disabled the account of ${targetName(item)}`;
    case "user.enabled":
      return `Enabled the account of ${targetName(item)}`;
    case "user.roles.updated":
      return `Changed the roles of ${targetName(item)}`;
    case "user.password.reset":
      return `Reset the password of ${targetName(item)}`;
    case "module.activated":
      return `Activated the ${detailText(item, "module")} module`;
    case "module.deactivated":
      return `Deactivated the ${detailText(item, "module")} module`;
    default:
      return describeAcademic(item) ?? item.action;
  }
}

const ACADEMIC_ENTITY: Record<string, string> = {
  year: "academic year",
  term: "term",
  class: "class",
  section: "section",
  subject: "subject",
};

/** "academic.class.created" -> "Created the class Form 1". */
function describeAcademic(item: AuditItem): string | null {
  const [area, entity, verb] = item.action.split(".");
  if (area !== "academic" || !entity || !verb) return null;
  const name = detailText(item, "name");
  const what = `the ${ACADEMIC_ENTITY[entity] ?? entity}${name ? ` ${name}` : ""}`;
  switch (verb) {
    case "created":
      return `Created ${what}`;
    case "updated":
      return `Changed ${what}`;
    case "deleted":
      return `Deleted ${what}`;
    case "set_current":
      return `Made ${what} the current year`;
    case "subjects_updated":
      return `Changed the subjects and coefficients of ${what}`;
    default:
      return item.action;
  }
}

/** Warnings (failed or blocked sign-ins, token reuse) are highlighted. */
export function isWarning(action: string): boolean {
  return (
    action === "auth.login.failed" ||
    action === "auth.login.blocked" ||
    action === "auth.refresh.reused" ||
    action === "auth.password.change_failed"
  );
}
