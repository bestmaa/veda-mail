import "server-only";
import { readFile } from "node:fs/promises";
import {
  deleteEncryptedAttachment,
} from "@/server/attachments/attachment-crypto-store";
import {
  attachmentStateConflict,
  assertReservationQuota,
  assertUnexpired,
  attachmentSnapshot,
  authorizeAttachment,
  transitionAttachment,
  type StoredAttachment,
} from "@/server/attachments/attachment-record";
import { resolveAttachmentLifetimeOptions } from
  "@/server/attachments/attachment-quarantine-options";
import {
  createAttachmentId,
  deriveScopeBindings,
  normalizeAttachmentMimeType,
  resolveAttachmentEncryptionKey,
  resolveAttachmentQuotas,
  sanitizeAttachmentFileName,
} from "@/server/attachments/attachment-security";
import { sharedAttachmentRepository } from
  "@/server/attachments/shared-attachment-repository";
import { readSharedClaimedAttachment } from
  "@/server/attachments/shared-attachment-read";
import type {
  AttachmentBody,
  AttachmentQuarantineOptions,
  AttachmentReservation,
  AttachmentScope,
  AttachmentSnapshot,
} from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from
  "@/server/attachments/attachment-types";
import { uploadQuarantinedAttachment } from
  "@/server/attachments/attachment-upload";
export class SharedAttachmentQuarantine {
  readonly #directory: string;
  readonly #key: Buffer;
  readonly #mimeDetector: AttachmentQuarantineOptions["mimeDetector"];
  readonly #now: () => number;
  readonly #quotas;
  readonly #repository;
  readonly #scanner: AttachmentQuarantineOptions["scanner"];
  readonly #ttlMs: number;
  readonly #uploadIdleTimeoutMs: number;
  readonly #uploadTimeoutMs: number;
  public constructor(options: AttachmentQuarantineOptions) {
    const lifetime = resolveAttachmentLifetimeOptions(options);
    this.#directory = options.directory;
    this.#key = resolveAttachmentEncryptionKey(options.encryptionKey);
    this.#mimeDetector = options.mimeDetector;
    this.#now = options.now ?? Date.now;
    this.#quotas = resolveAttachmentQuotas(options.quotas);
    this.#repository = sharedAttachmentRepository(this.#key);
    this.#scanner = options.scanner;
    this.#ttlMs = lifetime.ttlMs;
    this.#uploadIdleTimeoutMs = lifetime.uploadIdleTimeoutMs;
    this.#uploadTimeoutMs = lifetime.uploadTimeoutMs;
  }
  public async reserve(input: AttachmentReservation): Promise<AttachmentSnapshot> {
    return this.#repository.withLock(async () => {
      await this.#cleanupLocked();
      const now = this.#now();
      const bindings = deriveScopeBindings(this.#key, input.scope);
      assertReservationQuota(
        await this.#repository.list(), bindings, input.contentLength, this.#quotas,
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
      await this.#repository.put(record);
      return attachmentSnapshot(record);
    });
  }
  public async upload(
    id: string,
    scope: AttachmentScope,
    body: AttachmentBody,
    contentLength: number,
    signal?: AbortSignal,
  ): Promise<AttachmentSnapshot> {
    const shared = await this.#repository.withLock(async () => {
      const record = authorizeAttachment(
        await this.#repository.get(id), this.#key, scope,
      );
      assertUnexpired(record, this.#now());
      if (record.state !== "reserved") {
        attachmentStateConflict("Attachment is not ready for upload.");
      }
      transitionAttachment(record, "uploading");
      await this.#repository.put(record);
      return record;
    });
    const local: StoredAttachment = { ...shared, state: "reserved" };
    const records = new Map([[id, local]]);
    try {
      const snapshot = await uploadQuarantinedAttachment({
        directory: this.#directory,
        key: this.#key,
        maximumBytes: this.#quotas.maxFileBytes,
        mimeDetector: this.#mimeDetector,
        now: this.#now,
        records,
        scanner: this.#scanner,
        ...(signal ? { signal } : {}),
        uploadIdleTimeoutMs: this.#uploadIdleTimeoutMs,
        uploadTimeoutMs: this.#uploadTimeoutMs,
      }, local, id, body, contentLength);
      const encryptedFile = local.encryptedFile;
      if (!encryptedFile) throw new Error("Encrypted upload is missing.");
      const ciphertext = await readFile(`${this.#directory}/${encryptedFile}`);
      await this.#repository.putBlob(id, ciphertext, local.expiresAt);
      await this.#repository.withLock(async () => {
        const current = authorizeAttachment(
          await this.#repository.get(id), this.#key, scope,
        );
        if (current.state !== "uploading") {
          attachmentStateConflict("Attachment upload was superseded.");
        }
        await this.#repository.put(local);
      });
      return snapshot;
    } catch (error) {
      await this.#rejectUpload(id, scope);
      throw error;
    } finally {
      await deleteEncryptedAttachment(
        this.#directory, local.encryptedFile,
      ).catch(() => undefined);
    }
  }
  public async inspect(id: string, scope: AttachmentScope) {
    await this.cleanupExpired();
    return attachmentSnapshot(authorizeAttachment(
      await this.#repository.get(id), this.#key, scope,
    ));
  }
  public async claim(ids: readonly string[], scope: AttachmentScope) {
    return this.#transitionMany(ids, scope, "clean", "claimed");
  }
  public async release(ids: readonly string[], scope: AttachmentScope) {
    return this.#transitionMany(ids, scope, "claimed", "clean");
  }
  public async readClaimed(id: string, scope: AttachmentScope): Promise<Buffer> {
    return readSharedClaimedAttachment(
      this.#repository, this.#key, this.#now, id, scope,
    );
  }
  public async consume(ids: readonly string[], scope: AttachmentScope) {
    return this.#repository.withLock(async () => {
      const records = await this.#records(ids, scope, "claimed");
      records.forEach((record) => transitionAttachment(record, "consumed"));
      await this.#repository.removeMany(records.map(({ id }) => id));
      return records.map(attachmentSnapshot);
    });
  }
  public async remove(id: string, scope: AttachmentScope): Promise<void> {
    await this.#repository.withLock(async () => {
      const record = await this.#repository.get(id);
      if (!record) return;
      authorizeAttachment(record, this.#key, scope);
      await this.#repository.remove(id);
    });
  }
  public async cleanupExpired(): Promise<number> {
    return this.#repository.withLock(() => this.#cleanupLocked());
  }
  async #cleanupLocked(): Promise<number> {
    const expired = (await this.#repository.list())
      .filter(({ expiresAt }) => expiresAt <= this.#now());
    await this.#repository.removeMany(expired.map(({ id }) => id));
    return expired.length;
  }
  async #records(ids: readonly string[], scope: AttachmentScope, state: string) {
    if (ids.length === 0 || new Set(ids).size !== ids.length) {
      throw new AttachmentQuarantineError(
        "Attachment selection is invalid.", "INVALID_ATTACHMENT_SELECTION", 400,
      );
    }
    const records = await Promise.all(ids.map(async (id) => authorizeAttachment(
      await this.#repository.get(id), this.#key, scope,
    )));
    if (records.some((record) => record.state !== state)) {
      attachmentStateConflict("Attachment selection is not in the required state.");
    }
    return records;
  }

  async #transitionMany(
    ids: readonly string[], scope: AttachmentScope,
    from: "clean" | "claimed", to: "claimed" | "clean",
  ) {
    return this.#repository.withLock(async () => {
      const records = await this.#records(ids, scope, from);
      records.forEach((record) => transitionAttachment(record, to));
      await this.#repository.putMany(records);
      return records.map(attachmentSnapshot);
    });
  }
  async #rejectUpload(id: string, scope: AttachmentScope): Promise<void> {
    await this.#repository.withLock(async () => {
      const record = await this.#repository.get(id);
      if (!record) return;
      authorizeAttachment(record, this.#key, scope);
      if (["reserved", "uploading", "quarantined", "clean", "claimed"]
        .includes(record.state)) transitionAttachment(record, "rejected");
      await this.#repository.removeBlob(id);
      await this.#repository.put(record);
    }).catch(() => undefined);
  }
}
export const createSharedAttachmentQuarantine = (
  options: AttachmentQuarantineOptions,
): SharedAttachmentQuarantine => new SharedAttachmentQuarantine(options);
