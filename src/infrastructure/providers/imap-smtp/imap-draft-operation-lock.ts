import "server-only";

import { canonicalDraftComposeId } from "@/domain/mail/draft-validation";
import type { DraftId } from "@/domain/shared/brand";
import { imapMessageAccountScope } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const tails = new Map<string, Promise<void>>();

export const withImapDraftOperation = async <T>(
  config: ImapSmtpMemberConfig,
  composeId: DraftId,
  task: () => Promise<T>,
): Promise<T> => {
  const key = `${imapMessageAccountScope(config)}\0${canonicalDraftComposeId(composeId)}`;
  const previous = tails.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (tails.get(key) === current) tails.delete(key);
  }
};
