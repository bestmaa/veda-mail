import "server-only";

import { Readable } from "node:stream";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import {
  asCalendarPartId,
  type CalendarPart,
  type CalendarPartDownload,
  type CalendarPartDownloadInput,
  type CalendarPartListInput,
} from "@/domain/mail/calendar";
import { createBoundedAttachmentDownloadStream } from "@/infrastructure/providers/attachment-download-stream";
import { isImapTimeoutError } from "@/infrastructure/providers/imap-smtp/imap-attachment-download";
import {
  collectImapCalendarParts,
  findImapCalendarPart,
} from "@/infrastructure/providers/imap-smtp/imap-calendar-part";
import {
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import {
  closeImapClient,
  connectImapClient,
} from "@/infrastructure/providers/imap-smtp/imap-client";
import { imapAttachmentAccountScope } from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const DOWNLOAD_CHUNK_BYTES = 64 * 1024;

const calendarError = (
  code: ConstructorParameters<typeof AttachmentDownloadError>[0],
  message: string,
): AttachmentDownloadError => new AttachmentDownloadError(code, message);

const notFound = (): AttachmentDownloadError =>
  calendarError("not_found", "Calendar invitation not found.");

const normalizeError = (
  error: unknown,
  signal?: AbortSignal,
): AttachmentDownloadError => {
  if (error instanceof AttachmentDownloadError) return error;
  if (signal?.aborted) {
    return calendarError("aborted", "The calendar invitation lookup was cancelled.");
  }
  if (isImapTimeoutError(error)) {
    return calendarError("timeout", "The mail provider calendar lookup timed out.");
  }
  return calendarError(
    "provider_failure",
    "The mail provider could not read calendar invitation parts.",
  );
};

const awaitWithSignal = async <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(normalizeError(null, signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (!settled) { settled = true; resolve(value); }
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (!settled) { settled = true; reject(error); }
      },
    );
    if (signal.aborted) onAbort();
  });
};

const referenceFor = (
  config: ImapSmtpMemberConfig,
  messageId: CalendarPartListInput["messageId"],
) => {
  try {
    return decodeScopedImapMessageId(config, messageId);
  } catch {
    throw notFound();
  }
};

export const listImapCalendarParts = async (
  config: ImapSmtpMemberConfig,
  input: CalendarPartListInput,
): Promise<readonly CalendarPart[]> => {
  if (input.signal?.aborted) throw normalizeError(null, input.signal);
  const reference = referenceFor(config, input.messageId);
  const client = await connectImapClient(config, input.signal).catch(
    (error: unknown) => { throw normalizeError(error, input.signal); },
  );
  const onAbort = (): void => {
    try {
      client.close();
    } catch {
      // The raced provider operation is normalized below.
    }
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const opened = await awaitWithSignal(
      client.mailboxOpen(reference.mailbox, { readOnly: true }), input.signal,
    );
    if (!imapUidValidityMatches(reference, opened.uidValidity)) throw notFound();
    const message = await awaitWithSignal(
      client.fetchOne(
        reference.uid,
        { bodyStructure: true, uid: true },
        { uid: true },
      ),
      input.signal,
    );
    if (!message || message.uid !== reference.uid || !message.bodyStructure) {
      throw notFound();
    }
    return collectImapCalendarParts({
      accountScope: imapAttachmentAccountScope(config),
      messageId: input.messageId,
      structure: message.bodyStructure,
      uidValidity: opened.uidValidity,
    }).map(({ id, name, size }) => ({
      id: asCalendarPartId(id),
      mimeType: "text/calendar" as const,
      name,
      size,
    }));
  } catch (error) {
    throw normalizeError(error, input.signal);
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    await closeImapClient(client);
  }
};

const assertDownloadInput = (input: CalendarPartDownloadInput): void => {
  if (
    !Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0 ||
    input.maxBytes >= Number.MAX_SAFE_INTEGER
  ) {
    throw calendarError("invalid_request", "Calendar download limits were invalid.");
  }
  if (input.signal?.aborted) throw normalizeError(null, input.signal);
};

export const downloadImapCalendarPart = async (
  config: ImapSmtpMemberConfig,
  input: CalendarPartDownloadInput,
): Promise<CalendarPartDownload> => {
  assertDownloadInput(input);
  const reference = referenceFor(config, input.messageId);
  const client = await connectImapClient(config, input.signal).catch(
    (error: unknown) => { throw normalizeError(error, input.signal); },
  );
  let finalizePromise: Promise<void> | undefined;
  const finalize = async (): Promise<void> => {
    finalizePromise ??= closeImapClient(client);
    await finalizePromise;
  };
  const onAbort = (): void => void finalize();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const opened = await awaitWithSignal(
      client.mailboxOpen(reference.mailbox, { readOnly: true }), input.signal,
    );
    if (!imapUidValidityMatches(reference, opened.uidValidity)) throw notFound();
    const message = await awaitWithSignal(
      client.fetchOne(
        reference.uid,
        { bodyStructure: true, uid: true },
        { uid: true },
      ),
      input.signal,
    );
    if (!message || message.uid !== reference.uid || !message.bodyStructure) {
      throw notFound();
    }
    const calendar = findImapCalendarPart({
      accountScope: imapAttachmentAccountScope(config),
      messageId: input.messageId,
      structure: message.bodyStructure,
      uidValidity: opened.uidValidity,
    }, input.calendarPartId);
    if (!calendar) throw notFound();
    const downloaded = await awaitWithSignal(
      client.download(reference.uid, calendar.part, {
        chunkSize: DOWNLOAD_CHUNK_BYTES,
        maxBytes: input.maxBytes + 1,
        uid: true,
      }),
      input.signal,
    );
    if (!downloaded?.content) {
      throw calendarError(
        "provider_failure",
        "The mail provider returned no calendar invitation content.",
      );
    }
    const source = Readable.toWeb(downloaded.content) as ReadableStream<Uint8Array>;
    return {
      body: createBoundedAttachmentDownloadStream({
        maxBytes: input.maxBytes,
        onFinalize: async () => {
          input.signal?.removeEventListener("abort", onAbort);
          await finalize();
        },
        ...(input.signal ? { signal: input.signal } : {}),
        source,
      }),
      mimeType: "text/calendar",
      name: calendar.name,
      size: null,
    };
  } catch (error) {
    input.signal?.removeEventListener("abort", onAbort);
    await finalize();
    throw normalizeError(error, input.signal);
  }
};
