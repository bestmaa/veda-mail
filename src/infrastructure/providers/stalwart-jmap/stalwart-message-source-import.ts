import "server-only";

import {
  MAX_MESSAGE_SOURCE_IMPORT_BYTES,
  type MessageSourceImportInput,
  type MessageSourceImportResult,
} from "@/domain/mail/message-source";
import { MessageSourceImportError } from "@/domain/mail/message-source-import-error";
import { id } from "@/domain/shared/brand";
import { JmapAttachmentTransport } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";
import { maximumJmapUploadBytes } from "@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  JMAP_MAIL,
  type StalwartConfig,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

export const importStalwartMessageSource = async (
  client: StalwartJmapClient,
  config: StalwartConfig,
  accountId: string,
  input: MessageSourceImportInput,
): Promise<MessageSourceImportResult> => {
  if (input.source.byteLength < 1 ||
      input.source.byteLength > MAX_MESSAGE_SOURCE_IMPORT_BYTES) {
    throw new MessageSourceImportError(
      "size_limit_exceeded",
      "Message source is empty or exceeds the import limit.",
    );
  }
  if (input.signal?.aborted) {
    throw new MessageSourceImportError("aborted", "Message import was cancelled.");
  }
  const session = await client.getSession(input.signal);
  const maximum = maximumJmapUploadBytes(session);
  if (input.source.byteLength > maximum) {
    throw new MessageSourceImportError(
      "size_limit_exceeded",
      "Message source exceeds the provider upload limit.",
    );
  }
  const origin = (await assertSafeProviderOrigin(config.baseUrl)).origin;
  const transport = new JmapAttachmentTransport({
    authorizationHeader: () => client.authorizationForProviderTransport(),
    baseUrl: origin,
    downloadUrl: session.downloadUrl,
    maxDownloadBytes: MAX_MESSAGE_SOURCE_IMPORT_BYTES,
    maxUploadBytes: maximum,
    uploadUrl: session.uploadUrl,
  });
  const handle = await transport.upload({
    accountId,
    body: input.source,
    contentLength: input.source.byteLength,
    fileName: "message.eml",
    mediaType: "message/rfc822",
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const upload = transport.providerUploadReference(handle);
  const response = await client.request([["Email/import", {
    accountId,
    emails: {
      import: {
        blobId: upload.blobId,
        keywords: {},
        mailboxIds: { [input.mailboxId]: true },
      },
    },
  }, "message-import"]], [JMAP_MAIL], input.signal);
  const result = client.result(
    response,
    "message-import",
    "Email/import",
    jmapSetResultSchema,
  );
  const imported = result.created?.["import"];
  if (result.accountId !== undefined && result.accountId !== accountId) {
    throw new MessageSourceImportError(
      "provider_failure",
      "Mail provider returned another account identity.",
    );
  }
  if (!imported?.id || result.notCreated?.["import"] !== undefined) {
    throw new MessageSourceImportError(
      "provider_rejected",
      "Mail provider rejected the RFC 5322 message source.",
    );
  }
  return { messageId: id.message(imported.id) };
};
