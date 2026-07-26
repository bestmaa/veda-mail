import "server-only";

export const isAdminRecoveryConfigured = (): boolean =>
  (process.env["VEDA_MAIL_ADMIN_RECOVERY_TOKEN"]?.length ?? 0) >= 32;
