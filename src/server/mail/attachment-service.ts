import "server-only";

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OutgoingMessageSizeError } from "@/domain/mail/mail-errors";
import type { ProviderConnection } from "@/domain/provider/provider";
import type { DraftId } from "@/domain/shared/brand";
import {
  AttachmentQuarantineError,
  createAttachmentQuarantine,
  type AttachmentScanner,
  type AttachmentScope,
} from "@/server/attachments";
import {
  ClamAvAttachmentScanner,
  MagicNumberMimeDetector,
} from "@/server/security/attachment-inspection";
import { scheduleAttachmentScanner } from "@/server/security/attachment-scan-scheduler";
import { getMailService } from "@/server/mail/mail-service";
import { getMailContentPolicy } from "@/server/organization/mail-content-policy.service";
import { logError } from "@/server/observability/structured-log";
import { ApiError } from "@/transport/http/api-error";

const globalAttachments = globalThis as typeof globalThis & {
  __vedaMailAttachmentCleanupTimer?: NodeJS.Timeout;
  __vedaMailAttachmentScanner?: AttachmentScanner;
  __vedaMailAttachmentService?: ReturnType<typeof createAttachmentQuarantine>;
};
const ATTACHMENT_DIRECTORY_PREFIX = "veda-mail-attachments-";
const ATTACHMENT_EXPIRY_SWEEP_MS = 60 * 1_000;
const MAX_ORPHAN_DIRECTORIES_PER_SWEEP = 128;

const cleanTestScanner: AttachmentScanner = {
  async scan(content) {
    for await (const chunk of content) void chunk;
    return { verdict: "clean" };
  },
};

export const attachmentScanner = (): AttachmentScanner => {
  if (globalAttachments.__vedaMailAttachmentScanner) {
    return globalAttachments.__vedaMailAttachmentScanner;
  }
  const scanner =
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" &&
      process.env["VEDA_MAIL_ATTACHMENT_SCANNER"] === "test-clean")
      ? cleanTestScanner
      : new ClamAvAttachmentScanner();
  globalAttachments.__vedaMailAttachmentScanner =
    scheduleAttachmentScanner(scanner);
  return globalAttachments.__vedaMailAttachmentScanner;
};

export const removeAttachmentOrphanDirectories = (
  root = tmpdir(),
  maximum = MAX_ORPHAN_DIRECTORIES_PER_SWEEP,
): number => {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_024) {
    throw new RangeError("Attachment orphan cleanup limit is invalid.");
  }
  const resolvedRoot = path.resolve(root);
  let removed = 0;
  for (const entry of readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (removed >= maximum) break;
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(ATTACHMENT_DIRECTORY_PREFIX)
    ) {
      continue;
    }
    const target = path.resolve(resolvedRoot, entry.name);
    if (path.dirname(target) !== resolvedRoot) continue;
    rmSync(target, { force: true, maxRetries: 2, recursive: true });
    removed += 1;
  }
  return removed;
};

export const scheduleAttachmentExpirySweep = (
  service: ReturnType<typeof createAttachmentQuarantine>,
  intervalMs = ATTACHMENT_EXPIRY_SWEEP_MS,
): NodeJS.Timeout => {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new RangeError("Attachment expiry sweep interval is invalid.");
  }
  const timer = setInterval(() => {
    void service.cleanupExpired().catch(() => {
      logError("attachment.expiry_cleanup_failed", { outcome: "error" });
    });
  }, intervalMs);
  timer.unref();
  return timer;
};

export const attachmentService = () => {
  if (globalAttachments.__vedaMailAttachmentService) {
    return globalAttachments.__vedaMailAttachmentService;
  }
  if (process.env.NODE_ENV === "production") {
    removeAttachmentOrphanDirectories();
  }
  const service = createAttachmentQuarantine({
    directory: mkdtempSync(
      path.join(tmpdir(), `${ATTACHMENT_DIRECTORY_PREFIX}${process.pid}-`),
    ),
    mimeDetector: new MagicNumberMimeDetector(),
    scanner: attachmentScanner(),
  });
  globalAttachments.__vedaMailAttachmentService = service;
  globalAttachments.__vedaMailAttachmentCleanupTimer =
    scheduleAttachmentExpirySweep(service);
  return service;
};

export const attachmentScope = (
  connection: ProviderConnection,
  draftId: DraftId,
): AttachmentScope => {
  const mailboxIdentity = connection.config?.["username"]?.trim().toLowerCase();
  return {
    connectionId: connection.id,
    draftId,
    ownerId: mailboxIdentity
      ? `${connection.providerId}:${mailboxIdentity}`
      : connection.id,
    sessionId: connection.id,
  };
};

export const resolveAttachmentCapability = async (
  connection: ProviderConnection,
): Promise<number> => {
  const [providerMaximum, policy] = await Promise.all([
    (await getMailService(connection)).getMaxAttachmentBytes(),
    getMailContentPolicy(),
  ]);
  const maximum = Math.min(providerMaximum, policy.maxAttachmentBytes);
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error("Mail provider returned an invalid attachment limit.");
  }
  return maximum;
};

export type AttachmentCapabilityStatus =
  "available" | "unavailable" | "unsupported";

export const loadAttachmentCapability = async (
  connection: ProviderConnection,
): Promise<{
  readonly maxAttachmentBytes: number | null;
  readonly status: AttachmentCapabilityStatus;
}> => {
  try {
    const maxAttachmentBytes = await resolveAttachmentCapability(connection);
    return {
      maxAttachmentBytes,
      status: maxAttachmentBytes > 0 ? "available" : "unsupported",
    };
  } catch {
    return { maxAttachmentBytes: null, status: "unavailable" };
  }
};

export const assertAttachmentCapability = async (
  connection: ProviderConnection,
  contentLength: number,
): Promise<number> => {
  let maximum: number;
  try {
    maximum = await resolveAttachmentCapability(connection);
  } catch {
    throw new ApiError(
      "The mail provider attachment limit could not be verified.",
      "ATTACHMENT_CAPABILITY_UNAVAILABLE",
      503,
    );
  }
  if (maximum <= 0) {
    throw new ApiError(
      "Attachments are not available for this mail provider.",
      "ATTACHMENTS_UNSUPPORTED",
      409,
    );
  }
  if (contentLength > maximum) {
    throw new ApiError(
      "This file exceeds the mail provider attachment limit.",
      "ATTACHMENT_TOO_LARGE",
      413,
    );
  }
  return maximum;
};

export const asAttachmentApiError = (error: unknown): unknown =>
  error instanceof AttachmentQuarantineError
    ? new ApiError(error.message, error.code, error.status)
    : error instanceof OutgoingMessageSizeError
      ? new ApiError(error.message, "ATTACHMENT_MESSAGE_TOO_LARGE", 413)
      : error;
