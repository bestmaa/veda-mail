const SPECIAL_PRIMITIVE_EXPORTS = new Map([
  [
    "@/server/mail/attachment-archive-concurrency",
    new Map([["acquireAttachmentArchiveLease", "archive-lease"]]),
  ],
  [
    "@/server/mail/attachment-archive-ticket",
    new Map([["consumeAttachmentArchiveTicket", "ticket-guard"]]),
  ],
  [
    "@/server/security/rate-limit",
    new Map([["assertSubjectRateLimit", "subject-rate"]]),
  ],
]);

export const specialPrimitiveFields = (moduleName) =>
  SPECIAL_PRIMITIVE_EXPORTS.get(moduleName) ?? null;

export const specialPrimitiveForExport = (moduleName, exportName) =>
  specialPrimitiveFields(moduleName)?.get(exportName) ?? null;
