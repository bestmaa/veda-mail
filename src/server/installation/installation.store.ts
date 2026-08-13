import "server-only";

import {
  type BrandingSnapshot,
  type AdminTwoFactor,
  type InstallationRecord,
  type OrganizationBranding,
  type PasswordDigest,
} from "@/domain/installation/installation";
import type {
  MailServiceProfile,
  MailServiceProfileInput,
} from "@/domain/provider/provider";
import {
  createInstallation,
  readInstallation,
  writeInstallation,
} from "@/server/installation/installation-file";
import { installationBrandingSnapshot } from "@/server/installation/installation-branding-snapshot";
import { installationRecordSchema } from "@/server/installation/installation.schema";
import { createInstallationRecord } from "@/server/installation/installation-record";
import {
  ensureInstallationMigrated,
  replaceSharedInstallation,
  sharedInstallation,
} from "@/server/installation/installation-shared";
import { mailServiceProfileInputSchema } from "@/server/mail-service/mail-service-profile.schema";
import { withSetupLock } from "@/server/installation/setup-lock";
import { ApiError } from "@/transport/http/api-error";

interface StoreState {
  writeQueue: Promise<void>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailInstallationStore?: StoreState;
};

const state = globalState.__vedaMailInstallationStore ?? {
  writeQueue: Promise.resolve(),
};

globalState.__vedaMailInstallationStore = state;

export interface InstallationDraft {
  readonly mailProfile: MailServiceProfileInput;
  readonly organization: OrganizationBranding;
  readonly owner: {
    readonly password: PasswordDigest;
    readonly username: string;
  };
}

const serializeWrite = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = state.writeQueue.then(task, task);
  state.writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const SHARED_RETRY_LIMIT = 10;

const setupRequired = (): ApiError =>
  new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);

const sharedConflict = (): ApiError =>
  new ApiError(
    "Installation settings are busy. Try again.",
    "INSTALLATION_SHARED_CONFLICT",
    503,
  );

const currentInstallation = async (): Promise<InstallationRecord | null> => {
  if (await ensureInstallationMigrated()) {
    return (await sharedInstallation()).installation;
  }
  return readInstallation();
};

export const installationStore = {
  async complete(
    createDraft: () => Promise<InstallationDraft>,
  ): Promise<InstallationRecord> {
    return serializeWrite(() =>
      withSetupLock(async () => {
        const shared = await ensureInstallationMigrated();
        const current = shared
          ? await sharedInstallation()
          : { installation: await readInstallation(), serialized: null };
        if (current.installation) {
          throw new ApiError(
            "First-run setup has already been completed.",
            "SETUP_ALREADY_COMPLETED",
            409,
          );
        }
        const installation = createInstallationRecord(await createDraft());
        if (shared) {
          if (!(await replaceSharedInstallation(current, installation))) {
            throw new ApiError(
              "First-run setup has already been completed.",
              "SETUP_ALREADY_COMPLETED",
              409,
            );
          }
        } else {
          await createInstallation(installation);
        }
        return installation;
      }),
    );
  },

  async get(): Promise<InstallationRecord | null> {
    return currentInstallation();
  },

  async getBranding(): Promise<BrandingSnapshot> {
    return installationBrandingSnapshot(await currentInstallation());
  },

  async isInstalled(): Promise<boolean> {
    return Boolean(await currentInstallation());
  },

  async updateMailProfile(
    input: MailServiceProfileInput,
  ): Promise<MailServiceProfile> {
    const parsed = mailServiceProfileInputSchema.parse(input);
    return serializeWrite(async () => {
      const shared = await ensureInstallationMigrated();
      for (let attempt = 0; attempt < (shared ? SHARED_RETRY_LIMIT : 1); attempt += 1) {
        const record = shared
          ? await sharedInstallation()
          : { installation: await readInstallation(), serialized: null };
        const current = record.installation;
        if (!current) throw setupRequired();
        const now = new Date().toISOString();
        const mailProfile: MailServiceProfile = {
          ...parsed,
          createdAt: current.mailProfile.createdAt,
          updatedAt: now,
          version: 1,
        };
        const updated = installationRecordSchema.parse({
          ...current,
          mailProfile,
          updatedAt: now,
        });
        if (!shared) {
          await writeInstallation(updated);
          return mailProfile;
        }
        if (await replaceSharedInstallation(record, updated)) return mailProfile;
      }
      throw sharedConflict();
    });
  },

  async updateBranding(
    createOrganization: (
      current: OrganizationBranding,
    ) => Promise<OrganizationBranding>,
  ): Promise<{
    previous: OrganizationBranding;
    updated: InstallationRecord;
  }> {
    return serializeWrite(async () => {
      const shared = await ensureInstallationMigrated();
      for (let attempt = 0; attempt < (shared ? SHARED_RETRY_LIMIT : 1); attempt += 1) {
        const record = shared
          ? await sharedInstallation()
          : { installation: await readInstallation(), serialized: null };
        const current = record.installation;
        if (!current) throw setupRequired();
        const organization = await createOrganization(current.organization);
        const updated = installationRecordSchema.parse({
          ...current,
          organization,
          updatedAt: new Date().toISOString(),
        });
        if (!shared) {
          await writeInstallation(updated);
          return { previous: current.organization, updated };
        }
        if (await replaceSharedInstallation(record, updated)) {
          return { previous: current.organization, updated };
        }
      }
      throw sharedConflict();
    });
  },

  async updateOwner(
    expectedAuthVersion: number,
    owner: {
      password: PasswordDigest;
      twoFactor: AdminTwoFactor | null;
      username: string;
    },
  ): Promise<InstallationRecord> {
    return serializeWrite(async () => {
      const shared = await ensureInstallationMigrated();
      for (let attempt = 0; attempt < (shared ? SHARED_RETRY_LIMIT : 1); attempt += 1) {
        const record = shared
          ? await sharedInstallation()
          : { installation: await readInstallation(), serialized: null };
        const current = record.installation;
        if (!current) throw setupRequired();
        if (current.owner.authVersion !== expectedAuthVersion) {
          throw new ApiError(
            "Administrator account changed. Sign in and try again.",
            "ADMIN_ACCOUNT_CHANGED",
            409,
          );
        }
        const now = new Date().toISOString();
        const updated = installationRecordSchema.parse({
          ...current,
          owner: {
            authVersion: current.owner.authVersion + 1,
            password: owner.password,
            twoFactor: owner.twoFactor,
            updatedAt: now,
            username: owner.username,
          },
          updatedAt: now,
        });
        if (!shared) {
          await writeInstallation(updated);
          return updated;
        }
        if (await replaceSharedInstallation(record, updated)) return updated;
      }
      throw sharedConflict();
    });
  },
};
