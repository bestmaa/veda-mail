export const DEFAULT_PUBLIC_REPOSITORY_URL =
  "https://github.com/bestmaa/veda-mail";

export interface BrandingSnapshot {
  readonly accentColor: string;
  readonly logoUrl: string | null;
  readonly organizationName: string;
  readonly primaryColor: string;
  readonly productName: string;
  readonly publicRepositoryUrl: string | null;
}

export interface PasswordDigest {
  readonly algorithm: "scrypt";
  readonly digest: string;
  readonly salt: string;
}

export interface AdminEncryptedSecret {
  readonly algorithm: "aes-256-gcm";
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

export interface AdminRecoveryCodeDigest {
  readonly algorithm: "sha256";
  readonly digest: string;
  readonly salt: string;
}

export interface AdminTwoFactor {
  readonly enabledAt: string;
  readonly otpUrl: AdminEncryptedSecret;
  readonly recoveryCodes: readonly AdminRecoveryCodeDigest[];
}

export interface OwnerAdmin {
  readonly authVersion: number;
  readonly password: PasswordDigest;
  readonly twoFactor: AdminTwoFactor | null;
  readonly updatedAt: string;
  readonly username: string;
}

export interface OrganizationBranding {
  readonly accentColor: string;
  readonly logoFileName: string | null;
  readonly organizationName: string;
  readonly primaryColor: string;
  readonly productName: string;
  readonly publicRepositoryUrl: string | null;
}

export interface InstallationRecord {
  readonly installedAt: string;
  readonly mailProfile: MailServiceProfile;
  readonly organization: OrganizationBranding;
  readonly owner: OwnerAdmin;
  readonly sessionSecret: string;
  readonly updatedAt: string;
  readonly version: 1;
}
import type { MailServiceProfile } from "@/domain/provider/provider";
