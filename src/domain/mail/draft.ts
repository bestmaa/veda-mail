import type { MailAddress } from "@/domain/mail/mail";
import type {
  DraftId,
  MessageId,
  ProviderDraftId,
} from "@/domain/shared/brand";

export type DraftCapability =
  | { readonly status: "read-only" }
  | { readonly status: "supported" }
  | { readonly status: "unavailable" }
  | { readonly status: "unsupported" };

export interface DraftContent {
  readonly bcc: readonly MailAddress[];
  readonly body: string;
  readonly cc: readonly MailAddress[];
  readonly htmlBody?: string;
  readonly inReplyTo?: MessageId;
  readonly subject: string;
  readonly to: readonly MailAddress[];
}

export interface DraftDetail {
  readonly composeId: DraftId | null;
  readonly content: DraftContent;
  readonly hasAttachments: boolean;
  readonly hasTruncatedContent: boolean;
  readonly hasUncertainSubmission: boolean;
  readonly id: ProviderDraftId;
  readonly revision: string;
  readonly updatedAt: string;
}

export type DraftSaveInput =
  | {
      readonly composeId: DraftId;
      readonly content: DraftContent;
      readonly expectedRevision?: never;
      readonly providerDraftId?: never;
    }
  | {
      readonly composeId: DraftId;
      readonly content: DraftContent;
      readonly expectedRevision: string;
      readonly providerDraftId: ProviderDraftId;
    };

export interface SavedProviderDraft {
  readonly composeId: DraftId;
  readonly expectedRevision: string;
  readonly id: ProviderDraftId;
}
