import "server-only";

import {
  bindJmapMessageAttachment,
  downloadJmapAttachment,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-download";
import { providerUploadReference } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-handle";
import {
  assertJmapByteLimit,
  assertJmapText,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-request";
import type {
  JmapAttachmentHandle,
  JmapAttachmentTransportConfig,
  JmapBindMessageAttachmentInput,
  JmapDownloadedAttachment,
  JmapDownloadAttachmentInput,
  JmapProviderUploadReference,
  JmapUploadAttachmentInput,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { uploadJmapAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-upload";

const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;
const MAX_OPERATION_TIMEOUT_MS = 300_000;

const cancelled = (): JmapAttachmentTransportError =>
  new JmapAttachmentTransportError(
    "aborted",
    "The attachment operation was cancelled.",
  );

export class JmapAttachmentTransport {
  private readonly config: JmapAttachmentTransportConfig;
  private readonly operationTimeoutMs: number;
  private readonly owner = Object.freeze({});

  public constructor(config: JmapAttachmentTransportConfig) {
    assertJmapByteLimit(config.maxUploadBytes);
    assertJmapByteLimit(config.maxDownloadBytes);
    assertJmapText(config.baseUrl, 4_096);
    assertJmapText(config.uploadUrl, 4_096);
    assertJmapText(config.downloadUrl, 4_096);
    const timeout = config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(timeout) ||
      timeout <= 0 ||
      timeout > MAX_OPERATION_TIMEOUT_MS
    ) {
      throw new JmapAttachmentTransportError(
        "invalid_input",
        "Attachment operation timeout was invalid.",
      );
    }
    this.operationTimeoutMs = timeout;
    this.config = Object.freeze({ ...config });
  }

  public async upload(
    input: JmapUploadAttachmentInput,
  ): Promise<JmapAttachmentHandle> {
    return this.run(input.signal, (signal) =>
      uploadJmapAttachment(this.config, { ...input, signal }, this.owner),
    );
  }

  public bindMessageAttachment(
    input: JmapBindMessageAttachmentInput,
  ): JmapAttachmentHandle {
    return bindJmapMessageAttachment(input, this.owner);
  }

  public providerUploadReference(
    attachment: JmapAttachmentHandle,
  ): JmapProviderUploadReference {
    const reference = providerUploadReference(attachment, this.owner);
    if (!reference) {
      throw new JmapAttachmentTransportError(
        "invalid_handle",
        "The attachment handle is not a provider upload.",
      );
    }
    return reference;
  }

  public async download(
    input: JmapDownloadAttachmentInput,
  ): Promise<JmapDownloadedAttachment> {
    if (input.signal?.aborted) throw cancelled();
    const controller = new AbortController();
    let finished = false;
    const onCallerAbort = (): void => controller.abort(cancelled());
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onCallerAbort);
    };
    input.signal?.addEventListener("abort", onCallerAbort, { once: true });
    if (input.signal?.aborted) onCallerAbort();
    const timer = setTimeout(
      () =>
        controller.abort(
          new JmapAttachmentTransportError(
            "timeout",
            "The mail provider attachment operation timed out.",
          ),
        ),
      this.operationTimeoutMs,
    );
    try {
      return await downloadJmapAttachment(
        this.config,
        { ...input, signal: controller.signal },
        this.owner,
        finish,
      );
    } catch (error) {
      finish();
      if (controller.signal.reason instanceof JmapAttachmentTransportError) {
        throw controller.signal.reason;
      }
      throw error;
    }
  }

  private async run<T>(
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (callerSignal?.aborted) throw cancelled();
    const controller = new AbortController();
    let rejectCancellation: (
      reason: JmapAttachmentTransportError,
    ) => void = () => undefined;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const onCallerAbort = (): void => {
      rejectCancellation(cancelled());
      controller.abort();
    };
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      rejectCancellation(
        new JmapAttachmentTransportError(
          "timeout",
          "The mail provider attachment operation timed out.",
        ),
      );
      controller.abort();
    }, this.operationTimeoutMs);
    try {
      return await Promise.race([operation(controller.signal), cancellation]);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

export type {
  JmapAttachmentHandle,
  JmapAttachmentRequestBody,
  JmapAttachmentTransportConfig,
  JmapAttachmentTransportErrorCode,
  JmapBindMessageAttachmentInput,
  JmapDownloadedAttachment,
  JmapDownloadAttachmentInput,
  JmapProviderUploadReference,
  JmapPublicAttachment,
  JmapUploadAttachmentInput,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
export { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
