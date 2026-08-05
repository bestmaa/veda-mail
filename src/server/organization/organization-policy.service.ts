import "server-only";

import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type {
  OrganizationFeaturePolicy,
  OrganizationPolicyFeature,
} from "@/domain/installation/organization-policy";
import type { ProviderCapabilities } from "@/domain/provider/provider";
import { installationStore } from "@/server/installation/installation.store";
import { organizationPolicyStore } from "@/server/organization/organization-policy.store";
import { ApiError } from "@/transport/http/api-error";

export interface AdminCapabilityRow {
  readonly effective: boolean;
  readonly id: string;
  readonly label: string;
  readonly organizationControl: OrganizationPolicyFeature | null;
  readonly organizationEnabled: boolean | null;
  readonly providerSupported: boolean;
}

export interface AdminCapabilitySnapshot {
  readonly capabilities: readonly AdminCapabilityRow[];
  readonly policy: OrganizationFeaturePolicy;
  readonly provider: {
    readonly id: string;
    readonly name: string;
  };
}

interface CapabilityDefinition {
  readonly id: string;
  readonly label: string;
  readonly organizationControl?: OrganizationPolicyFeature;
  readonly supported: (capabilities: ProviderCapabilities) => boolean;
}

const definitions: readonly CapabilityDefinition[] = [
  {
    id: "server-search",
    label: "Server-side search",
    supported: ({ supportsServerSearch }) => supportsServerSearch,
  },
  {
    id: "provider-drafts",
    label: "Provider-backed drafts",
    supported: ({ supportsDrafts }) => supportsDrafts,
  },
  {
    id: "conversation-threads",
    label: "Conversation threads",
    supported: ({ supportsThreads }) => supportsThreads,
  },
  {
    id: "mailbox-push",
    label: "Live mailbox push",
    supported: ({ supportsPush }) => supportsPush,
  },
  {
    id: "attachment-send",
    label: "Attachment upload and send",
    supported: ({ maxAttachmentBytes }) => maxAttachmentBytes > 0,
  },
  {
    id: "attachment-download",
    label: "Received attachment download",
    supported: ({
      maxAttachmentDownloadBytes,
      supportsAttachmentDownload,
    }) => supportsAttachmentDownload && maxAttachmentDownloadBytes > 0,
  },
  {
    id: "member-profile",
    label: "Member profile editing",
    organizationControl: "memberProfileEditing",
    supported: ({ supportsProfileSettings }) => supportsProfileSettings,
  },
  {
    id: "member-password",
    label: "Member password changes",
    organizationControl: "memberPasswordChange",
    supported: ({ supportsPasswordChange }) => supportsPasswordChange,
  },
  {
    id: "member-two-factor",
    label: "New webmail 2FA enrollment",
    organizationControl: "memberTwoFactorEnrollment",
    supported: () => true,
  },
];

export const createAdminCapabilitySnapshot = (
  provider: { readonly id: string; readonly name: string },
  capabilities: ProviderCapabilities,
  policy: OrganizationFeaturePolicy,
): AdminCapabilitySnapshot => ({
  capabilities: definitions.map((definition) => {
    const providerSupported = definition.supported(capabilities);
    const organizationControl = definition.organizationControl ?? null;
    const organizationEnabled = organizationControl
      ? policy[organizationControl]
      : null;
    return {
      effective: providerSupported && organizationEnabled !== false,
      id: definition.id,
      label: definition.label,
      organizationControl,
      organizationEnabled,
      providerSupported,
    };
  }),
  policy,
  provider,
});

export const getAdminCapabilitySnapshot = async () => {
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  }
  let provider;
  try {
    provider = getProviderRegistry().get(installation.mailProfile.providerId);
  } catch {
    throw new ApiError(
      "The configured mail provider is unavailable.",
      "UNKNOWN_PROVIDER",
      503,
    );
  }
  return createAdminCapabilitySnapshot(
    { id: provider.manifest.id, name: provider.manifest.name },
    provider.manifest.capabilities,
    await organizationPolicyStore.get(),
  );
};

export const assertOrganizationFeatureEnabled = async (
  feature: OrganizationPolicyFeature,
): Promise<void> => {
  const policy = await organizationPolicyStore.get();
  if (!policy[feature]) {
    throw new ApiError(
      "Your organization has disabled this account feature.",
      "ORGANIZATION_POLICY_DISABLED",
      403,
    );
  }
};

export const getOrganizationPolicy = async (): Promise<OrganizationFeaturePolicy> =>
  organizationPolicyStore.get();
