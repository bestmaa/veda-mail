import "server-only";

import { JmapAttachmentTransport } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";
import { maximumJmapUploadBytes } from "@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartSieveContentPort } from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";
import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const MAX_SIEVE_BYTES = 1024 * 1024;
const FILE_NAME = "veda-mail-rules.sieve";
const MEDIA_TYPE = "application/sieve";
const SCOPE_ID = "veda-mail-rules-script";

export class StalwartSieveTransport implements StalwartSieveContentPort {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly config: StalwartConfig,
  ) {}

  public async upload(input: {
    readonly accountId: string;
    readonly content: Uint8Array;
    readonly mediaType: "application/sieve";
  }) {
    if (input.mediaType !== MEDIA_TYPE || input.content.byteLength < 1) {
      throw new Error("The Sieve upload was invalid.");
    }
    const transport = await this.transport();
    const handle = await transport.upload({
      accountId: input.accountId,
      body: input.content,
      contentLength: input.content.byteLength,
      fileName: FILE_NAME,
      mediaType: MEDIA_TYPE,
    });
    const provider = transport.providerUploadReference(handle);
    return {
      accountId: input.accountId,
      blobId: provider.blobId,
      mediaType: provider.type,
      size: provider.size,
    };
  }

  public async download(input: {
    readonly accountId: string;
    readonly blobId: string;
    readonly maxBytes: number;
  }): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes < 1 ||
      input.maxBytes > MAX_SIEVE_BYTES
    ) {
      throw new Error("The Sieve download limit was invalid.");
    }
    const transport = await this.transport();
    const handle = transport.bindMessageAttachment({
      accountId: input.accountId,
      fileName: FILE_NAME,
      mediaType: MEDIA_TYPE,
      messageId: SCOPE_ID,
      providerBlobId: input.blobId,
      size: null,
    });
    const downloaded = await transport.download({
      attachment: handle,
      maxBytes: input.maxBytes,
      messageId: SCOPE_ID,
    });
    return new Uint8Array(await new Response(downloaded.body).arrayBuffer());
  }

  private async transport(): Promise<JmapAttachmentTransport> {
    const session = await this.client.getSession();
    const uploadLimit = Math.min(
      MAX_SIEVE_BYTES,
      maximumJmapUploadBytes(session),
    );
    return new JmapAttachmentTransport({
      authorizationHeader: () =>
        this.client.authorizationForProviderTransport(),
      baseUrl: this.config.baseUrl,
      downloadUrl: session.downloadUrl,
      maxDownloadBytes: MAX_SIEVE_BYTES,
      maxUploadBytes: uploadLimit,
      uploadUrl: session.uploadUrl,
    });
  }
}
