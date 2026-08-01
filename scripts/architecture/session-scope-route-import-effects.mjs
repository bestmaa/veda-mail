const AUTH_WRAPPER_EXPORTS = new Map([
  ["@/server/mail/mail-service", new Set(["getMailService"])],
]);

const REQUEST_UTILITY_EXPORTS = new Map([
  ["@/server/installation/request-origin", new Set(["assertSameOrigin"])],
  [
    "@/server/security/rate-limit",
    new Set(["assertRequestRateLimit"]),
  ],
  ["@/transport/http/api-response", new Set(["apiFailure", "apiSuccess"])],
  ["@/transport/http/read-json-body", new Set(["readJsonBody"])],
]);

const REVIEWED_HELPER_EXPORTS = new Map([
  ["node:crypto", new Set(["createHash", "randomUUID"])],
  ["next/server", new Set(["NextResponse"])],
  ["zod", new Set(["z"])],
  ["@/bootstrap/provider-registry", new Set(["getProviderRegistry"])],
  ["@/domain/mail/send-receipt", new Set(["canonicalizeSendReceipt"])],
  ["@/domain/mail/mailbox-policy", new Set(["assertMailboxMutation"])],
  ["@/domain/shared/brand", new Set(["id"])],
  ["@/server/connections/connection-store", new Set(["connectionStore"])],
  ["@/server/auth/member-two-factor", new Set(["memberTwoFactorSecurity"])],
  ["@/server/auth/two-factor-enrollment", new Set(["twoFactorEnrollmentStore"])],
  ["@/server/attachments", new Set(["parseAttachmentContentLength"])],
  ["@/server/mail-service/mail-service-profile.store", new Set(["mailServiceProfileStore"])],
  ["@/server/mail/attachment-original-import", new Set(["importOriginalAttachment"])],
  ["@/server/mail/attachment-preview", new Set(["prepareTextAttachmentPreview"])],
  ["@/server/mail/inline-image", new Set(["prepareInlineImage"])],
  [
    "@/server/mail/attachment-service",
    new Set([
      "assertAttachmentCapability",
      "asAttachmentApiError",
      "attachmentScanner",
      "attachmentScope",
      "attachmentService",
      "loadAttachmentCapability",
    ]),
  ],
  ["@/server/mail/attachment-send-memory-budget", new Set(["attachmentSendMemoryBudget"])],
  ["@/server/mail/outgoing-mail-content", new Set(["canonicalizeOutgoingMailContent"])],
  ["@/server/mailboxes/mailbox-appearance.store", new Set(["mailboxAppearanceStore"])],
  [
    "@/server/preferences/message-list-preferences.store",
    new Set(["messageListPreferencesStore"]),
  ],
  ["@/server/mailboxes/mailbox-empty.service", new Set(["emptyMailboxBatch"])],
  [
    "@/server/messages/message-move.service",
    new Set([
      "authorizeMessageMoveMailboxes",
      "authorizeMessageMoveMembership",
      "moveMessage",
    ]),
  ],
  ["@/server/labels/label-catalog.store", new Set(["labelCatalogStore"])],
  ["@/server/labels/label-http", new Set(["labelHttpError"])],
  [
    "@/server/labels/label-operation.service",
    new Set([
      "deleteLabelBatch",
      "mutateBulkMessageLabels",
      "mutateMessageLabel",
    ]),
  ],
  [
    "@/server/mailboxes/mailbox-http",
    new Set(["decorateMailboxesSafely", "mailboxHttpError", "mailboxOwner"]),
  ],
  ["@/server/mail/protected", new Set(["readProtectedMailbox"])],
  [
    "@/server/mail/send-idempotency",
    new Set([
      "completeIdempotentSend",
      "failIdempotentSend",
      "prepareIdempotentSend",
    ]),
  ],
  ["@/server/mail/attachment-archive", new Set(["preflightAttachmentArchive", "prepareAttachmentArchive"])],
  ["@/server/mail/attachment-archive-ticket", new Set(["issueAttachmentArchiveTicket"])],
  ["@/server/mail/attachment-download-concurrency", new Set(["acquireAttachmentDownloadLease"])],
  ["@/server/mail/attachment-archive-http", new Set(["*"])],
  [
    "@/server/mail/attachment-download-http",
    new Set([
      "asAttachmentDownloadApiError",
      "attachmentDownloadFailure",
      "attachmentDownloadHeaders",
      "createAttachmentDownloadResponse",
      "parseAttachmentDownloadRouteParams",
    ]),
  ],
  ["@/server/mail/attachment-preview-http", new Set(["*"])],
  ["@/server/mail/inline-image-http", new Set(["*"])],
  ["@/server/mail/attachment-import", new Set(["asAttachmentImportApiError"])],
  ["@/server/mail/delivery-notice-store", new Set(["deliveryNoticeStore"])],
  [
    "@/server/mail/draft-http",
    new Set([
      "asDraftApiError",
      "asDraftDomainApiError",
      "canonicalizeDraftRequestContent",
    ]),
  ],
  ["@/server/mail/gateway-cache", new Set(["resolveGateway"])],
  ["@/server/security/attachment-inspection", new Set(["MagicNumberMimeDetector"])],
  ["@/server/signatures/email-signature.schema", new Set(["parseEmailSignaturePutOperation"])],
  ["@/server/signatures/email-signature.store", new Set(["emailSignatureStore"])],
  ["@/transport/http/request-schemas", new Set(["*"])],
  ["@/transport/http/mailbox-mutation.schema", new Set(["*"])],
  ["@/transport/http/mailbox-empty.schema", new Set(["*"])],
  ["@/transport/http/message-list-preferences.schema", new Set(["*"])],
  ["@/transport/http/label.schema", new Set(["*"])],
  [
    "@/transport/http/draft-schemas",
    new Set([
      "createDraftSchema",
      "deleteDraftSchema",
      "providerDraftIdSchema",
      "updateDraftSchema",
    ]),
  ],
  ["@/transport/http/api-error", new Set(["ApiError"])],
]);

const hasExport = (registry, moduleName, exportName) =>
  registry.get(moduleName)?.has(exportName) ||
  registry.get(moduleName)?.has("*") ||
  false;

export const isAuthWrapperExport = (moduleName, exportName) =>
  hasExport(AUTH_WRAPPER_EXPORTS, moduleName, exportName);

export const isRequestUtilityExport = (moduleName, exportName) =>
  hasExport(REQUEST_UTILITY_EXPORTS, moduleName, exportName) ||
  hasExport(REVIEWED_HELPER_EXPORTS, moduleName, exportName);

export const isAuthWrapperModule = (moduleName) =>
  AUTH_WRAPPER_EXPORTS.has(moduleName);

export const isRequestUtilityModule = (moduleName) =>
  REQUEST_UTILITY_EXPORTS.has(moduleName) ||
  REVIEWED_HELPER_EXPORTS.has(moduleName);

export const knownAuthWrapperName = (exportName) =>
  [...AUTH_WRAPPER_EXPORTS.values()].some((names) => names.has(exportName));

export const knownRequestUtilityName = (exportName) =>
  [...REQUEST_UTILITY_EXPORTS.values(), ...REVIEWED_HELPER_EXPORTS.values()]
    .some((names) => names.has(exportName));
