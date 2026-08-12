import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import {
  DEFAULT_MESSAGE_LIST_PREFERENCES,
  type MessageListPreferences,
  type MessageListPreferencesOwner,
} from "@/domain/mail/message-list-preferences";
import { installationStore } from "@/server/installation/installation.store";
import {
  archiveMigratedMessageListPreferencesFile,
  readMessageListPreferencesFile,
  writeMessageListPreferencesFile,
} from "@/server/preferences/message-list-preferences-file";
import {
  type EncryptedMessageListPreferences,
  encryptedMessageListPreferencesSchema,
  storedMessageListPreferencesSchema,
} from "@/server/preferences/message-list-preferences-record";
import { ApiError } from "@/transport/http/api-error";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";
import { messageListPreferencesSchema } from "@/transport/http/message-list-preferences.schema";

const OWNER_CONTEXT = "veda-mail/message-list-preferences/owner/v1";
const ENCRYPTION_CONTEXT = "veda-mail/message-list-preferences/encryption/v1";
const globalState = globalThis as typeof globalThis & {
  __vedaMailMessageListPreferencesQueue?: Promise<void>;
};
globalState.__vedaMailMessageListPreferencesQueue ??= Promise.resolve();
let migrationPromise: Promise<boolean> | undefined;

const unavailable = (): never => {
  throw new ApiError(
    "Message list preferences are temporarily unavailable.",
    "MESSAGE_LIST_PREFERENCES_UNAVAILABLE",
    500,
  );
};

const sessionSecret = async (): Promise<string> => {
  try {
    const installation = await installationStore.get();
    return installation?.sessionSecret ?? unavailable();
  } catch {
    return unavailable();
  }
};

const normalizedEmail = (email: string): string => {
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  return separator < 1
    ? value
    : `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

export const messageListPreferencesOwnerKey = (
  owner: MessageListPreferencesOwner,
  secret: string,
): string => createHmac("sha256", secret)
  .update(OWNER_CONTEXT).update("\0")
  .update(`${owner.providerId.trim().toLowerCase()}\0${normalizedEmail(owner.email)}`)
  .digest("base64url");

const encryptionKey = (secret: string): Buffer => Buffer.from(hkdfSync(
  "sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), ENCRYPTION_CONTEXT, 32,
));

const encrypt = (
  preferences: MessageListPreferences,
  ownerKey: string,
  secret: string,
): EncryptedMessageListPreferences => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(`${ENCRYPTION_CONTEXT}\0${ownerKey}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({
      preferences,
      updatedAt: new Date().toISOString(),
      version: 1,
    }), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

const decrypt = (
  value: EncryptedMessageListPreferences,
  ownerKey: string,
  secret: string,
): MessageListPreferences => {
  const decipher = createDecipheriv(
    "aes-256-gcm", encryptionKey(secret), Buffer.from(value.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${ENCRYPTION_CONTEXT}\0${ownerKey}`, "utf8"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return storedMessageListPreferencesSchema.parse(JSON.parse(plaintext)).preferences;
};

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailMessageListPreferencesQueue!.then(task, task);
  globalState.__vedaMailMessageListPreferencesQueue = result.then(
    () => undefined, () => undefined,
  );
  return result;
};

const ensureMigrated = (): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "message-list-preferences",
    async () => {
      const file = await readMessageListPreferencesFile();
      return Object.fromEntries(Object.entries(file.owners)
        .map(([owner, value]) => [owner, JSON.stringify(value)]));
    },
    archiveMigratedMessageListPreferencesFile,
  );
  return migrationPromise;
};

const sharedEncrypted = async (
  ownerKey: string,
): Promise<EncryptedMessageListPreferences | undefined> => {
  const value = await sharedOwnerRepository.get(
    "message-list-preferences", ownerKey,
  );
  return value
    ? encryptedMessageListPreferencesSchema.parse(JSON.parse(value))
    : undefined;
};

export const messageListPreferencesStore = {
  async get(owner: MessageListPreferencesOwner): Promise<MessageListPreferences> {
    try {
      const secret = await sessionSecret();
      const ownerKey = messageListPreferencesOwnerKey(owner, secret);
      const encrypted = await ensureMigrated()
        ? await sharedEncrypted(ownerKey)
        : (await readMessageListPreferencesFile()).owners[ownerKey];
      return encrypted
        ? decrypt(encrypted, ownerKey, secret)
        : { ...DEFAULT_MESSAGE_LIST_PREFERENCES };
    } catch {
      return unavailable();
    }
  },

  async set(owner: MessageListPreferencesOwner, input: MessageListPreferences) {
    const preferences = messageListPreferencesSchema.parse(input);
    return serialized(async () => {
      const secret = await sessionSecret();
      try {
        const ownerKey = messageListPreferencesOwnerKey(owner, secret);
        if (await ensureMigrated()) {
          await sharedOwnerRepository.replace(
            "message-list-preferences",
            ownerKey,
            JSON.stringify(encrypt(preferences, ownerKey, secret)),
          );
          return preferences;
        }
        const file = await readMessageListPreferencesFile();
        const updatedAt = new Date().toISOString();
        await writeMessageListPreferencesFile({
          ...file,
          owners: {
            ...file.owners,
            [ownerKey]: encrypt(preferences, ownerKey, secret),
          },
          updatedAt,
        });
        return preferences;
      } catch {
        return unavailable();
      }
    });
  },
};
