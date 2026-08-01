import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type {
  Mailbox,
  MessageDetail,
  MessageMutation,
} from "@/domain/mail/mail";
import { ApiError } from "@/transport/http/api-error";

type MoveMutation = Extract<MessageMutation, { readonly type: "move" }>;
type MoveMailboxRequest = Pick<
  MoveMutation,
  "destinationMailboxId" | "sourceMailboxId" | "type"
>;

export interface MessageMoveContext {
  readonly destination: Mailbox;
  readonly source: Mailbox;
}

const policyFailure = (
  message: string,
  code: string,
  status: number,
): never => {
  throw new ApiError(message, code, status);
};

export const authorizeMessageMoveMailboxes = (
  mailboxes: readonly Mailbox[],
  mutation: MoveMailboxRequest,
): MessageMoveContext => {
  const source = mailboxes.find(({ id }) => id === mutation.sourceMailboxId);
  const destination = mailboxes.find(
    ({ id }) => id === mutation.destinationMailboxId,
  );
  if (!source || !destination) {
    return policyFailure(
      "The selected source or destination mailbox is unavailable.",
      "MESSAGE_MOVE_MAILBOX_UNAVAILABLE",
      400,
    );
  }
  if (source.id === destination.id) {
    return policyFailure(
      "Choose a different destination mailbox.",
      "MESSAGE_MOVE_SAME_MAILBOX",
      400,
    );
  }
  if (source.rights.mayRemoveItems !== true) {
    return policyFailure(
      "The mail provider does not allow messages to leave this mailbox.",
      "MESSAGE_MOVE_SOURCE_FORBIDDEN",
      403,
    );
  }
  if (
    destination.rights.mayAddItems !== true ||
    destination.role === "drafts" ||
    destination.role === "sent"
  ) {
    return policyFailure(
      "The mail provider does not allow messages in that destination.",
      "MESSAGE_MOVE_DESTINATION_FORBIDDEN",
      403,
    );
  }
  return { destination, source };
};

export const authorizeMessageMoveMembership = (
  message: MessageDetail,
  context: MessageMoveContext,
): void => {
  if (!message.mailboxIds.includes(context.source.id)) {
    policyFailure(
      "The message is no longer in the selected source mailbox.",
      "MESSAGE_MOVE_SOURCE_STALE",
      409,
    );
  }
  if (message.mailboxIds.includes(context.destination.id)) {
    policyFailure(
      "The message is already in the selected destination mailbox.",
      "MESSAGE_MOVE_ALREADY_PRESENT",
      409,
    );
  }
};

export const moveMessage = async (
  service: MailApplicationService,
  mutation: MoveMutation,
): Promise<void> => {
  const [mailboxes, message] = await Promise.all([
    service.listMailboxes(),
    service.getMessage(mutation.messageId),
  ]);
  const context = authorizeMessageMoveMailboxes(mailboxes, mutation);
  authorizeMessageMoveMembership(message, context);
  await service.mutateMessage(mutation);
};
