import "server-only";

import path from "node:path";

import {
  assertReservationQuota,
  attachmentSnapshot,
  authorizeAttachment,
  type StoredAttachment,
} from "@/server/attachments/attachment-record";
import {
  claimAttachments,
  cleanupExpiredAttachments,
  consumeAttachments,
  readClaimedAttachment,
  releaseAttachments,
  removeAttachment,
} from "@/server/attachments/attachment-operations";
import {
  createAttachmentId,
  deriveScopeBindings,
  normalizeAttachmentMimeType,
  resolveAttachmentEncryptionKey,
  resolveAttachmentQuotas,
  sanitizeAttachmentFileName,
} from "@/server/attachments/attachment-security";
import { resolveAttachmentLifetimeOptions } from
  "@/server/attachments/attachment-quarantine-options";
import type {
  AttachmentBody,
  AttachmentQuarantineOptions,
  AttachmentReservation,
  AttachmentScope,
  AttachmentSnapshot,
} from "@/server/attachments/attachment-types";
import { uploadQuarantinedAttachment } from "@/server/attachments/attachment-upload";

export class AttachmentQuarantine {
  readonly #directory: string;
  readonly #key: Buffer;
  readonly #mimeDetector: AttachmentQuarantineOptions["mimeDetector"];
  readonly #now: () => number;
  readonly #quotas;
  readonly #records = new Map<string, StoredAttachment>();
  readonly #scanner: AttachmentQuarantineOptions["scanner"];
  readonly #ttlMs: number;
  readonly #uploadIdleTimeoutMs: number;
  readonly #uploadTimeoutMs: number;

  public constructor(options: AttachmentQuarantineOptions) {
    const lifetime = resolveAttachmentLifetimeOptions(options);
    this.#directory = path.resolve(options.directory);
    this.#key = resolveAttachmentEncryptionKey(options.encryptionKey);
    this.#mimeDetector = options.mimeDetector;
    this.#now = options.now ?? Date.now;
    this.#quotas = resolveAttachmentQuotas(options.quotas);
    this.#scanner = options.scanner;
    this.#ttlMs = lifetime.ttlMs;
    this.#uploadIdleTimeoutMs = lifetime.uploadIdleTimeoutMs;
    this.#uploadTimeoutMs = lifetime.uploadTimeoutMs;
  }

  public async reserve(
    input: AttachmentReservation,
  ): Promise<AttachmentSnapshot> {
    await this.cleanupExpired();
    const now = this.#now();
    const bindings = deriveScopeBindings(this.#key, input.scope);
    assertReservationQuota(
      this.#records.values(),
      bindings,
      input.contentLength,
      this.#quotas,
    );
    const record: StoredAttachment = {
      bindings,
      contentLength: input.contentLength,
      createdAt: now,
      declaredMimeType: normalizeAttachmentMimeType(input.declaredMimeType),
      expiresAt: now + this.#ttlMs,
      fileName: sanitizeAttachmentFileName(input.fileName),
      id: createAttachmentId(),
      state: "reserved",
    };
    this.#records.set(record.id, record);
    return attachmentSnapshot(record);
  }

  public async upload(
    id: string,
    scope: AttachmentScope,
    body: AttachmentBody,
    contentLength: number,
    signal?: AbortSignal,
  ): Promise<AttachmentSnapshot> {
    const record = authorizeAttachment(this.#records.get(id), this.#key, scope);
    return uploadQuarantinedAttachment(
      {
        directory: this.#directory,
        key: this.#key,
        maximumBytes: this.#quotas.maxFileBytes,
        mimeDetector: this.#mimeDetector,
        now: this.#now,
        records: this.#records,
        scanner: this.#scanner,
        ...(signal ? { signal } : {}),
        uploadIdleTimeoutMs: this.#uploadIdleTimeoutMs,
        uploadTimeoutMs: this.#uploadTimeoutMs,
      },
      record,
      id,
      body,
      contentLength,
    );
  }

  public async inspect(
    id: string,
    scope: AttachmentScope,
  ): Promise<AttachmentSnapshot> {
    await this.cleanupExpired();
    return attachmentSnapshot(
      authorizeAttachment(this.#records.get(id), this.#key, scope),
    );
  }

  public async claim(
    ids: readonly string[],
    scope: AttachmentScope,
  ): Promise<readonly AttachmentSnapshot[]> {
    await this.cleanupExpired();
    return claimAttachments(this.#operations(), ids, scope);
  }

  public async readClaimed(
    id: string,
    scope: AttachmentScope,
  ): Promise<Buffer> {
    await this.cleanupExpired();
    return readClaimedAttachment(this.#operations(), id, scope);
  }

  public async release(
    ids: readonly string[],
    scope: AttachmentScope,
  ): Promise<readonly AttachmentSnapshot[]> {
    await this.cleanupExpired();
    return releaseAttachments(this.#operations(), ids, scope);
  }

  public async consume(
    ids: readonly string[],
    scope: AttachmentScope,
  ): Promise<readonly AttachmentSnapshot[]> {
    await this.cleanupExpired();
    return consumeAttachments(this.#operations(), ids, scope);
  }

  public async remove(id: string, scope: AttachmentScope): Promise<void> {
    return removeAttachment(this.#operations(), id, scope);
  }

  public async cleanupExpired(): Promise<number> {
    return cleanupExpiredAttachments(this.#operations());
  }

  #operations() {
    return {
      directory: this.#directory,
      key: this.#key,
      now: this.#now,
      records: this.#records,
    };
  }
}

export const createAttachmentQuarantine = (
  options: AttachmentQuarantineOptions,
): AttachmentQuarantine => new AttachmentQuarantine(options);
