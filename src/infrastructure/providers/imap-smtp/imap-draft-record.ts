import "server-only";

import type { ImapFlow } from "imapflow";

import { DraftContentTruncatedError, DraftNotFoundError } from "@/domain/mail/draft-errors";
import { id } from "@/domain/shared/brand";
import {
  encodeScopedImapMessageId,
  imapMessageAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { parseImapDraft } from "@/infrastructure/providers/imap-smtp/imap-draft-mime";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

export const MAX_IMAP_DRAFT_SOURCE_BYTES = 26 * 1024 * 1024;

export const loadImapDraftRecord = async (input: {
  readonly client: ImapFlow;
  readonly config: ImapSmtpMemberConfig;
  readonly mailbox: string;
  readonly uid: number;
  readonly uidValidity: bigint;
}) => {
  const message = await input.client.fetchOne(
    input.uid,
    {
      internalDate: true,
      size: true,
      source: { maxLength: MAX_IMAP_DRAFT_SOURCE_BYTES },
      uid: true,
    },
    { uid: true },
  );
  if (!message || message.uid !== input.uid || !message.source) {
    throw new DraftNotFoundError();
  }
  if (
    (message.size ?? message.source.byteLength) > MAX_IMAP_DRAFT_SOURCE_BYTES
  ) {
    throw new DraftContentTruncatedError();
  }
  const providerDraftId = id.providerDraft(
    encodeScopedImapMessageId(input.config, {
      mailbox: input.mailbox,
      uid: input.uid,
      uidValidity: input.uidValidity,
    }),
  );
  return {
    ...(await parseImapDraft({
      accountScope: imapMessageAccountScope(input.config),
      internalDate: message.internalDate,
      providerDraftId,
      source: message.source,
      username: input.config.username,
    })),
    uid: input.uid,
  };
};
