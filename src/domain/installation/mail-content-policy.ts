export interface MailContentPolicy {
  readonly allowedExtensions: readonly string[];
  readonly allowedMimeTypes: readonly string[];
  readonly blockedExtensions: readonly string[];
  readonly blockedMimeTypes: readonly string[];
  readonly maxAttachmentBytes: number;
  readonly maxAttachmentsPerMessage: number;
  readonly maxMessageBytes: number;
}

export const MAIL_CONTENT_POLICY_LIMITS = {
  maxAttachmentBytes: 18 * 1024 * 1024,
  maxAttachmentsPerMessage: 10,
  maxMessageBytes: 32 * 1024 * 1024,
  maxRulesPerList: 64,
} as const;

export const DEFAULT_MAIL_CONTENT_POLICY: MailContentPolicy = {
  allowedExtensions: [],
  allowedMimeTypes: [],
  blockedExtensions: [],
  blockedMimeTypes: [],
  maxAttachmentBytes: MAIL_CONTENT_POLICY_LIMITS.maxAttachmentBytes,
  maxAttachmentsPerMessage: MAIL_CONTENT_POLICY_LIMITS.maxAttachmentsPerMessage,
  maxMessageBytes: MAIL_CONTENT_POLICY_LIMITS.maxMessageBytes,
};
