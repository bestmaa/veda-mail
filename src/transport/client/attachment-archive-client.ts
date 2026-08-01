import { MAX_ATTACHMENT_ARCHIVE_OUTPUT_BYTES } from "@/domain/mail/attachment-archive-limits";
import { saveAttachmentResponse } from "@/transport/client/attachment-download-client";
import { apiClientErrorFromResponse } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";
import { API_ERROR_CODE_HEADER } from "@/transport/http/api-error";

const preflightFailure = (response: Response): string => {
  if (response.headers.get(API_ERROR_CODE_HEADER) === "MAIL_SESSION_CHANGED") {
    return "Mailbox session changed. Reload this page and try again.";
  }
  const messages: Readonly<Record<number, string>> = {
    401: "Please sign in again before downloading attachments.",
    404: "The message or one of its attachments is no longer available.",
    409: "This message does not have attachments to download.",
    413: "These attachments are too large to download together.",
    429: "Another archive is busy. Please try again shortly.",
    502: "The mail provider could not prepare these attachments.",
    504: "The mail provider took too long. Please try again.",
  };
  return messages[response.status] ??
    `Unable to prepare this ZIP (status ${response.status}).`;
};

const downloadFailure = (response: Response): string => {
  const messages: Readonly<Record<number, string>> = {
    401: "Please sign in again before downloading attachments.",
    403: "This archive request expired. Please try again.",
    404: "The message or one of its attachments is no longer available.",
    409: "This message does not have attachments to download.",
    413: "These attachments are too large to download together.",
    422: "One of these attachments was blocked by malware scanning.",
    429: "Attachment scanning is busy. Please try again shortly.",
    502: "The mail provider could not prepare these attachments.",
    503: "Attachment scanning is unavailable. Please try again.",
    504: "Attachment scanning took too long. Please try again.",
  };
  return messages[response.status] ??
    `Unable to download this ZIP (status ${response.status}).`;
};

export const preflightAttachmentArchive = async (
  href: string,
  sessionScope: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(href, {
    cache: "no-store",
    credentials: "same-origin",
    headers: mailSessionScopeHeaders(sessionScope),
    method: "POST",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw await apiClientErrorFromResponse(response, preflightFailure(response));
  }
  const payload = (await response.json()) as {
    readonly data?: { readonly ticket?: unknown };
  };
  if (
    typeof payload.data?.ticket !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(payload.data.ticket)
  ) throw new Error("The attachment archive ticket is invalid.");
  return `${href}?ticket=${encodeURIComponent(payload.data.ticket)}`;
};

export const downloadAttachmentArchive = async (
  href: string,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetch(href, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw await apiClientErrorFromResponse(response, downloadFailure(response));
  }
  if (response.headers.get("content-type") !== "application/zip") {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("The attachment archive returned an invalid response.");
  }
  await saveAttachmentResponse(
    response,
    "attachments.zip",
    MAX_ATTACHMENT_ARCHIVE_OUTPUT_BYTES,
  );
};
