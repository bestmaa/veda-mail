import "server-only";

import {
  MailUserAdministrationError,
  type MailUserAdministrationErrorCode,
} from "@/domain/admin/mail-user";
import { StalwartManagementRequestError } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";

export const duplicateMailUserError = (): MailUserAdministrationError =>
  new MailUserAdministrationError(
    "duplicate",
    "A mailbox with this email address already exists.",
  );

export const unknownCreateOutcomeError = (): MailUserAdministrationError =>
  new MailUserAdministrationError(
    "create-outcome-unknown",
    "The mailbox creation outcome could not be confirmed.",
  );

export const translateMailUserError = (
  error: unknown,
): MailUserAdministrationError => {
  if (error instanceof MailUserAdministrationError) return error;
  if (!(error instanceof StalwartManagementRequestError)) {
    return providerError("provider-unavailable");
  }
  const code: MailUserAdministrationErrorCode =
    error.code === "auth"
      ? "provider-auth"
      : error.code === "configuration"
        ? "configuration"
        : error.code === "unavailable"
          ? "provider-unavailable"
          : "provider-response";
  return providerError(code);
};

export const providerResponseError = (): MailUserAdministrationError =>
  providerError("provider-response");

const providerError = (
  code: MailUserAdministrationErrorCode,
): MailUserAdministrationError =>
  new MailUserAdministrationError(
    code,
    "Mailbox administration is temporarily unavailable.",
  );
