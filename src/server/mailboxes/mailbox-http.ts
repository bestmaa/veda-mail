import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type {
  Mailbox,
  MailboxAppearanceOwner,
} from "@/domain/mail/mailbox";
import { MailboxPolicyError } from "@/domain/mail/mailbox-policy";
import { mailboxAppearanceStore } from "@/server/mailboxes/mailbox-appearance.store";
import { ApiError } from "@/transport/http/api-error";

export const mailboxOwner = async (
  service: MailApplicationService,
): Promise<MailboxAppearanceOwner> => {
  const account = await service.getAccount();
  return { email: account.email, providerId: account.providerId };
};

export const decorateMailboxesSafely = async (
  owner: MailboxAppearanceOwner,
  mailboxes: readonly Mailbox[],
): Promise<readonly Mailbox[]> => {
  try {
    return await mailboxAppearanceStore.decorate(owner, mailboxes);
  } catch {
    return mailboxes;
  }
};

const statusFor = (failure: MailboxPolicyError["failure"]): number =>
  failure === "missing"
    ? 404
    : failure === "conflict" ||
        failure === "cycle" ||
        failure === "child-exists" ||
        failure === "mail-exists"
      ? 409
      : failure === "forbidden"
        ? 403
        : 400;

export const mailboxHttpError = (error: unknown): unknown =>
  error instanceof MailboxPolicyError
    ? new ApiError(
        error.message,
        `MAILBOX_${error.failure.toUpperCase().replaceAll("-", "_")}`,
        statusFor(error.failure),
      )
    : error;
