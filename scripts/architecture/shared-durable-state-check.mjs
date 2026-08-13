const policies = new Map([
  ["src/server/auth/member-two-factor-file.ts", "src/server/auth/member-two-factor-shared.ts"],
  ["src/server/branding/logo-store.ts", "src/server/branding/logo-store.ts"],
  ["src/server/calendar/event-file.ts", "src/server/calendar/event-store.ts"],
  ["src/server/contacts/contact-file.ts", "src/server/contacts/contact-store.ts"],
  ["src/server/installation/installation-file.ts", "src/server/installation/installation-shared.ts"],
  ["src/server/labels/label-catalog-file.ts", "src/server/labels/label-catalog-access.ts"],
  ["src/server/mail-users/mail-user-idempotency-file.ts", "src/server/mail-users/mail-user-idempotency-store.ts"],
  ["src/server/mailboxes/mailbox-appearance-file.ts", "src/server/mailboxes/mailbox-appearance.store.ts"],
  ["src/server/organization/data-retention-policy.store.ts", "src/server/organization/data-retention-policy.store.ts"],
  ["src/server/organization/mail-content-policy.store.ts", "src/server/organization/mail-content-policy.store.ts"],
  ["src/server/organization/organization-policy.store.ts", "src/server/organization/organization-policy.store.ts"],
  ["src/server/preferences/message-list-preferences-file.ts", "src/server/preferences/message-list-preferences.store.ts"],
  ["src/server/rules/rule-file.ts", "src/server/rules/rule-store.ts"],
  ["src/server/saved-searches/saved-search-file.ts", "src/server/saved-searches/saved-search-store.ts"],
  ["src/server/scheduled-send/scheduled-send-file.ts", "src/server/scheduled-send/scheduled-send-store-access.ts"],
  ["src/server/security-audit/security-audit-file.ts", "src/server/security-audit/security-audit.store.ts"],
  ["src/server/signatures/email-signature-file.ts", "src/server/signatures/email-signature.store.ts"],
  ["src/server/snooze/snooze-file.ts", "src/server/snooze/snooze-store-access.ts"],
  ["src/server/templates/email-template-file.ts", "src/server/templates/email-template.store.ts"],
]);

const localOnly = new Set([
  // Local advisory lock only; the installation record's Redis CAS is authoritative.
  "src/server/installation/setup-lock.ts",
  // Read-only filesystem readiness probe; it owns no durable application state.
  "src/server/observability/readiness.ts",
]);

export const sharedDurableStateViolations = (
  files,
  { enforceManifest = true } = {},
) => {
  const violations = [];
  const candidates = [...files.entries()].filter(([file, content]) =>
    file.startsWith("src/server/") && content.includes("VEDA_MAIL_DATA_DIR"));
  for (const [file] of candidates) {
    if (localOnly.has(file)) continue;
    const bridge = policies.get(file);
    if (!bridge) {
      violations.push(`${file} — Durable /data access needs an explicit shared-state policy`);
      continue;
    }
    const content = files.get(bridge);
    if (!content || !/shared|Redis/u.test(content)) {
      violations.push(`${file} — Shared-state bridge ${bridge} is missing or inactive`);
    }
  }
  if (enforceManifest) {
    for (const [file] of policies) {
      if (!files.has(file)) {
        violations.push(`${file} — Durable-state policy refers to a missing source file`);
      }
    }
  }
  return violations;
};
