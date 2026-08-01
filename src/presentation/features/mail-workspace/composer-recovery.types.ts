import type { ComposerDraftSaveAttempt } from "@/presentation/features/mail-workspace/composer-draft-save-attempt";
import type { MailAddress } from "@/domain/mail/mail";
import type {
  AccountId,
  AttachmentUploadId,
  DraftId,
  MessageId,
  ProviderDraftId,
  ProviderId,
} from "@/domain/shared/brand";

export const COMPOSER_RECOVERY_VERSION = 1 as const;

export type ComposerTitle =
  | "Edit draft"
  | "Forward message"
  | "New message"
  | "Reply all"
  | "Reply";

export interface ComposerRecoveryOwner {
  readonly accountId: AccountId;
  readonly providerId: ProviderId;
  readonly sessionExpiresAt: string;
  readonly sessionScope: string;
}

export type ComposerRecoveryBody =
  | {
      readonly mode: "plain";
      readonly text: string;
    }
  | {
      readonly html: string;
      readonly mode: "rich";
      readonly preserveLoadedHtml: boolean;
      readonly text: string;
    };

export interface ComposerRecoverySnapshot {
  readonly bcc: string;
  readonly body: ComposerRecoveryBody;
  readonly cc: string;
  readonly hadLocalAttachments: boolean;
  readonly inReplyTo?: MessageId;
  readonly signatureDisposition: "detached" | "none";
  readonly subject: string;
  readonly title: ComposerTitle;
  readonly to: string;
}

export interface ComposerRecoveryAcknowledgement {
  readonly generation: number;
  readonly providerDraftId: ProviderDraftId;
  readonly revision: string;
}

export type ComposerRecoverySendRequest = {
  readonly attachmentIds: readonly AttachmentUploadId[];
  readonly bcc: readonly MailAddress[];
  readonly body: string;
  readonly cc: readonly MailAddress[];
  readonly draftId: DraftId;
  readonly htmlBody?: string;
  readonly inReplyTo?: MessageId;
  readonly subject: string;
  readonly to: readonly MailAddress[];
} & (
  | {
      readonly expectedDraftRevision?: never;
      readonly providerDraftId?: never;
    }
  | {
      readonly expectedDraftRevision: string;
      readonly providerDraftId: ProviderDraftId;
    }
);

export interface ComposerRecoveryTerminalOwner {
  readonly accountId: AccountId;
  readonly providerId: ProviderId;
  readonly sessionScope: string;
}

interface ComposerRecoveryTerminalBase {
  readonly composeId: DraftId;
  readonly generation: number;
  readonly intentId: string;
  readonly issuedAt: string;
  readonly owner: ComposerRecoveryTerminalOwner;
}

export type ComposerRecoveryTerminalIntent =
  | (ComposerRecoveryTerminalBase & {
      readonly kind: "discard";
      readonly expectedRevision: string;
      readonly providerDraftId: ProviderDraftId;
      readonly state: "armed";
    })
  | (ComposerRecoveryTerminalBase & {
      readonly kind: "send";
      readonly requestFingerprint: string;
      readonly state: "armed" | "uncertain";
    } & (
      | {
          readonly expectedDraftRevision?: never;
          readonly providerDraftId?: never;
        }
      | {
          readonly expectedDraftRevision: string;
          readonly providerDraftId: ProviderDraftId;
        }
    ));

export interface ComposerRecoveryJournal {
  readonly acknowledged?: ComposerRecoveryAcknowledgement;
  readonly composeId: DraftId;
  readonly localGeneration: number;
  readonly owner: ComposerRecoveryOwner;
  readonly pendingSave?: ComposerDraftSaveAttempt;
  readonly recordId: string;
  readonly snapshot: ComposerRecoverySnapshot;
  readonly storageRevision: number;
  readonly terminalIntent?: ComposerRecoveryTerminalIntent;
  readonly updatedAt: string;
  readonly version: typeof COMPOSER_RECOVERY_VERSION;
}

export interface ComposerRecoveryPointer {
  readonly recordId: string;
  readonly sessionScope: string;
  readonly version: typeof COMPOSER_RECOVERY_VERSION;
}
