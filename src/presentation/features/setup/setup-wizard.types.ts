import type { ProviderManifest } from "@/domain/provider/provider";

export interface SetupFormData {
  readonly accentColor: string;
  readonly adminPassword: string;
  readonly adminPasswordConfirmation: string;
  readonly adminUsername: string;
  readonly allowedDomains: string;
  readonly logo: File | null;
  readonly organizationName: string;
  readonly primaryColor: string;
  readonly productName: string;
  readonly providerConfig: Readonly<Record<string, string>>;
  readonly providerDisplayName: string;
  readonly providerId: string;
  readonly publicRepositoryUrl: string;
  readonly setupToken: string;
}

export type SetupTextField = Exclude<
  keyof SetupFormData,
  "allowedDomains" | "logo" | "providerConfig"
>;

export interface SetupSnapshot {
  readonly installationRequired: boolean;
  readonly providers: readonly ProviderManifest[];
  readonly setupTokenConfigured: boolean;
}
