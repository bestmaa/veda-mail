import type {
  ProviderCapabilities,
  ProviderManifest,
} from "@/domain/provider/provider";
import type { OrganizationFeaturePolicy } from "@/domain/installation/organization-policy";
import type { MailContentPolicy } from "@/domain/installation/mail-content-policy";
import type { MemberProfile } from "@/domain/member/member-settings";
import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";
import {
  deleteResource,
  fetchData,
} from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export { ApiClientError } from "@/transport/client/api-request";
export { mailApi } from "@/transport/client/mail-api";
export {
  adminSessionsApi,
  memberSessionsApi,
  type AdminSessionsSnapshot,
  type ManagedSessionSummary,
  type MemberSessionsSnapshot,
} from "@/transport/client/session-api";

export interface MemberSignInInput {
  readonly email: string;
  readonly otpCode?: string;
  readonly password: string;
}

export interface MemberSettingsSnapshot {
  readonly attachmentCapability: {
    readonly status: "available" | "unavailable" | "unsupported";
  };
  readonly capabilities: {
    readonly mail: ProviderCapabilities;
    readonly passwordChange: boolean;
    readonly profileSettings: boolean;
    readonly twoFactorAuthentication: boolean;
  };
  readonly organizationPolicy: OrganizationFeaturePolicy;
  readonly profile: MemberProfile;
  readonly security: {
    readonly twoFactorEnabled: boolean;
  };
}

export interface MemberPasswordInput {
  readonly confirmPassword: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly otpCode?: string;
}

export interface SessionResult {
  readonly authenticated: boolean;
  readonly mfaRequired?: boolean;
  readonly providerLabel?: string;
}


export interface AdminMailServiceConfiguration {
  readonly allowedDomains: readonly string[];
  readonly config: Readonly<Record<string, string>>;
  readonly displayName: string;
  readonly providerId: string;
}

export interface AdminMailServiceSnapshot {
  readonly configuration: AdminMailServiceConfiguration | null;
  readonly providers: readonly ProviderManifest[];
}

export interface AdminCapabilitySnapshot {
  readonly capabilities: readonly {
    readonly effective: boolean;
    readonly id: string;
    readonly label: string;
    readonly organizationControl: keyof OrganizationFeaturePolicy | null;
    readonly organizationEnabled: boolean | null;
    readonly providerSupported: boolean;
  }[];
  readonly policy: OrganizationFeaturePolicy;
  readonly provider: {
    readonly id: string;
    readonly name: string;
  };
}

export const memberSessionApi = {
  signIn(input: MemberSignInInput) {
    return fetchData<SessionResult>("/api/v1/member/session", {
      body: JSON.stringify(input),
      method: "POST",
    });
  },

  signOut(sessionScope: string) {
    return deleteResource(
      "/api/v1/member/session",
      "Unable to sign out of this mailbox.",
      { headers: mailSessionScopeHeaders(sessionScope) },
    );
  },
};

export const memberSettingsApi = {
  changePassword(input: MemberPasswordInput, sessionScope: string) {
    return fetchData<{
      readonly changed: boolean;
      readonly sessionActive: boolean;
    }>("/api/v1/member/settings", {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PUT",
    });
  },

  get(sessionScope: string) {
    return fetchData<MemberSettingsSnapshot>("/api/v1/member/settings", {
      headers: mailSessionScopeHeaders(sessionScope),
    });
  },

  updateProfile(displayName: string, sessionScope: string) {
    return fetchData<{ readonly profile: MemberProfile }>(
      "/api/v1/member/settings",
      {
        body: JSON.stringify({ displayName }),
        headers: mailSessionScopeHeaders(sessionScope),
        method: "PATCH",
      },
    );
  },
};

export const memberTwoFactorApi = {
  confirm(currentPassword: string, otpCode: string, sessionScope: string) {
    return fetchData<{
      readonly enabled: true;
      readonly recoveryCodes: readonly string[];
      readonly sessionActive: boolean;
    }>("/api/v1/member/two-factor", {
      body: JSON.stringify({ currentPassword, otpCode }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PUT",
    });
  },

  disable(currentPassword: string, otpCode: string, sessionScope: string) {
    return fetchData<{
      readonly enabled: false;
      readonly sessionActive: boolean;
    }>("/api/v1/member/two-factor", {
      body: JSON.stringify({ currentPassword, otpCode }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "DELETE",
    });
  },

  start(sessionScope: string) {
    return fetchData<{ readonly enrollment: MemberTwoFactorEnrollment }>(
      "/api/v1/member/two-factor",
      {
        headers: mailSessionScopeHeaders(sessionScope),
        method: "POST",
      },
    );
  },
};

export const adminMailServiceApi = {
  get() {
    return fetchData<AdminMailServiceSnapshot>("/api/v1/admin/mail-service");
  },

  save(input: AdminMailServiceConfiguration) {
    return fetchData<AdminMailServiceSnapshot>("/api/v1/admin/mail-service", {
      body: JSON.stringify(input),
      method: "PUT",
    });
  },
};

export const adminCapabilitiesApi = {
  get() {
    return fetchData<AdminCapabilitySnapshot>("/api/v1/admin/capabilities");
  },

  save(policy: OrganizationFeaturePolicy) {
    return fetchData<AdminCapabilitySnapshot>("/api/v1/admin/capabilities", {
      body: JSON.stringify(policy),
      method: "PUT",
    });
  },
};

export const adminMailPolicyApi = {
  get() {
    return fetchData<{ readonly policy: MailContentPolicy }>(
      "/api/v1/admin/mail-policy",
    );
  },
  save(policy: MailContentPolicy) {
    return fetchData<{ readonly policy: MailContentPolicy }>(
      "/api/v1/admin/mail-policy",
      { body: JSON.stringify(policy), method: "PUT" },
    );
  },
};
