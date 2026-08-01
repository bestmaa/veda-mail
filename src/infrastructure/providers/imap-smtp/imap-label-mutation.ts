import "server-only";

import type { ImapFlow, MailboxObject } from "imapflow";

import type { MessageMutation } from "@/domain/mail/mail";
import { labelIdFromKeyword, type LabelCapability } from "@/domain/mail/label";

type LabelMutation = Extract<MessageMutation, { readonly type: "set-label" }>;

export const imapLabelCapability = (
  permanentFlags: Iterable<string> | undefined,
): LabelCapability => !permanentFlags || [...permanentFlags].some(
  (flag) => flag === "\\*" || labelIdFromKeyword(flag) !== null,
) ? "supported" : "unsupported";

export const mutateImapLabel = async (
  client: ImapFlow,
  opened: MailboxObject,
  uid: number,
  mutation: LabelMutation,
): Promise<void> => {
  const keyword = mutation.labelId;
  const permanentFlags = opened.permanentFlags;
  const keywordIsPermanent = permanentFlags
    ? [...permanentFlags].some((flag) =>
        flag === "\\*" || flag.toLowerCase() === keyword,
      )
    : true;
  if (mutation.value && !keywordIsPermanent) {
    throw new Error("This IMAP mailbox does not support custom labels.");
  }
  const update = mutation.value
    ? client.messageFlagsAdd.bind(client)
    : client.messageFlagsRemove.bind(client);
  await update(uid, [keyword], { uid: true });
  const verified = await client.fetchOne(
    uid,
    { flags: true, uid: true },
    { uid: true },
  );
  const hasKeyword = Boolean(verified && [...(verified.flags ?? [])].some(
    (flag) => flag.toLowerCase() === keyword,
  ));
  if (hasKeyword !== mutation.value) {
    throw new Error("The IMAP server did not persist the label change.");
  }
};
