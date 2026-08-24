import "server-only";

import type { AdminMailUserDetail } from "@/domain/admin/mail-user";

const isProtectedMailbox = (email: string): boolean => {
  const normalized = email.trim().toLowerCase();
  const localPart = normalized.slice(0, normalized.lastIndexOf("@"));
  const configured = new Set(
    (process.env["VEDA_MAIL_PROTECTED_MAILBOXES"] ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return localPart === "postmaster" || localPart === "abuse" ||
    configured.has(normalized);
};

export const protectMailUserLifecycle = (
  user: AdminMailUserDetail,
): AdminMailUserDetail => isProtectedMailbox(user.email) ? {
  ...user,
  lifecycle: {
    available: false,
    protected: true,
    reason: "protected-account",
  },
} : user;
