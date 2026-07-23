import type {
  ConnectionId,
  ProviderId,
} from "@/domain/shared/brand";

export interface ProviderCapabilities {
  readonly maxAttachmentBytes: number;
  readonly supportsDrafts: boolean;
  readonly supportsPush: boolean;
  readonly supportsServerSearch: boolean;
  readonly supportsThreads: boolean;
}

export type ProviderFieldKind = "email" | "password" | "select" | "text" | "url";
export type ProviderFieldScope = "member" | "service";

export interface ProviderFieldOption {
  readonly label: string;
  readonly value: string;
}

export interface ProviderFieldDefinition {
  readonly autocomplete?: string;
  readonly defaultValue?: string;
  readonly help?: string;
  readonly kind: ProviderFieldKind;
  readonly label: string;
  readonly name: string;
  readonly options?: readonly ProviderFieldOption[];
  readonly placeholder?: string;
  readonly required: boolean;
  readonly scope: ProviderFieldScope;
  readonly secret: boolean;
}

export interface ProviderManifest {
  readonly capabilities: ProviderCapabilities;
  readonly description: string;
  readonly fields: readonly ProviderFieldDefinition[];
  readonly id: ProviderId;
  readonly name: string;
}

export interface ConnectionInput {
  readonly config: Readonly<Record<string, string>>;
  readonly displayName: string;
  readonly providerId: ProviderId;
}

export interface MailServiceProfileInput {
  readonly allowedDomains: readonly string[];
  readonly config: Readonly<Record<string, string>>;
  readonly displayName: string;
  readonly providerId: ProviderId;
}

export interface MailServiceProfile extends MailServiceProfileInput {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface MemberCredentials {
  readonly email: string;
  readonly password: string;
}

export interface ProviderConnection {
  readonly config: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly displayName: string;
  readonly id: ConnectionId;
  readonly providerId: ProviderId;
}

export interface ActiveConnection {
  readonly displayName: string;
  readonly id: ConnectionId;
  readonly providerId: ProviderId;
}
