import "server-only";

import { randomBytes } from "node:crypto";

import {
  DEFAULT_PUBLIC_REPOSITORY_URL,
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
import { installationRecordSchema } from "@/server/installation/installation.schema";
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

const snapshot = (
  installation: InstallationRecord | null,
): BrandingSnapshot => ({
  accentColor: installation?.organization.accentColor ?? "#ff6b57",
  logoUrl: installation?.organization.logoFileName
    ? "/api/v1/branding/logo"
    : null,
  organizationName:
    installation?.organization.organizationName ?? "Your organization",
  primaryColor: installation?.organization.primaryColor ?? "#27276f",
  productName: installation?.organization.productName ?? "Veda Mail",
  publicRepositoryUrl:
    installation?.organization.publicRepositoryUrl ??
    DEFAULT_PUBLIC_REPOSITORY_URL,
});

export const installationStore = {
  async complete(
    createDraft: () => Promise<InstallationDraft>,
  ): Promise<InstallationRecord> {
    return serializeWrite(() =>
      withSetupLock(async () => {
        if (await readInstallation()) {
          throw new ApiError(
            "First-run setup has already been completed.",
            "SETUP_ALREADY_COMPLETED",
            409,
          );
        }
        const draft = await createDraft();
        const now = new Date().toISOString();
        const mailProfile: MailServiceProfile = {
          ...mailServiceProfileInputSchema.parse(draft.mailProfile),
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        const installation = installationRecordSchema.parse({
          installedAt: now,
          mailProfile,
          organization: draft.organization,
          owner: {
            authVersion: 1,
            password: draft.owner.password,
            twoFactor: null,
            updatedAt: now,
            username: draft.owner.username,
          },
          sessionSecret: randomBytes(48).toString("base64url"),
          updatedAt: now,
          version: 1,
        });
        await createInstallation(installation);
        return installation;
      }),
    );
  },

  async get(): Promise<InstallationRecord | null> {
    return readInstallation();
  },

  async getBranding(): Promise<BrandingSnapshot> {
    return snapshot(await readInstallation());
  },

  async isInstalled(): Promise<boolean> {
    return Boolean(await readInstallation());
  },

  async updateMailProfile(
    input: MailServiceProfileInput,
  ): Promise<MailServiceProfile> {
    const parsed = mailServiceProfileInputSchema.parse(input);
    return serializeWrite(async () => {
      const current = await readInstallation();
      if (!current) {
        throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
      }
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
      await writeInstallation(updated);
      return mailProfile;
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
      const current = await readInstallation();
      if (!current) {
        throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
      }
      const organization = await createOrganization(current.organization);
      const updated = installationRecordSchema.parse({
        ...current,
        organization,
        updatedAt: new Date().toISOString(),
      });
      await writeInstallation(updated);
      return { previous: current.organization, updated };
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
      const current = await readInstallation();
      if (!current) {
        throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
      }
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
      await writeInstallation(updated);
      return updated;
    });
  },
};
