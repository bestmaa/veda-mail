import type {
  ComposeInput,
  MailWorkspace,
  MessageDetail,
  MessageMutation,
  SendReceipt,
} from "@/domain/mail/mail";
import type { ProviderManifest } from "@/domain/provider/provider";
import type { MemberProfile } from "@/domain/member/member-settings";
import type { MailboxId, MessageId } from "@/domain/shared/brand";

interface ApiEnvelope<TData> {
  readonly data: TData;
}

interface ApiErrorEnvelope {
  readonly error?: { readonly message?: string };
}

export interface MemberSignInInput {
  readonly email: string;
  readonly password: string;
}

export interface MemberSettingsSnapshot {
  readonly capabilities: {
    readonly passwordChange: boolean;
    readonly profileSettings: boolean;
  };
  readonly profile: MemberProfile;
}

export interface MemberPasswordInput {
  readonly confirmPassword: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly otpCode?: string;
}

export interface SessionResult {
  readonly authenticated: boolean;
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

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const fetchData = async <TData>(
  input: string,
  init?: RequestInit,
): Promise<TData> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
    throw new ApiClientError(
      failure.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }
  return ((await response.json()) as ApiEnvelope<TData>).data;
};

const deleteResource = async (input: string, message: string): Promise<void> => {
  const response = await fetch(input, { method: "DELETE" });
  if (!response.ok) {
    throw new ApiClientError(message, response.status);
  }
};

export const mailApi = {
  getMessage(messageId: MessageId) {
    return fetchData<MessageDetail>(
      `/api/v1/mail/messages/${encodeURIComponent(messageId)}`,
    );
  },

  getWorkspace(input: {
    readonly mailboxId?: MailboxId;
    readonly search?: string;
  }) {
    const params = new URLSearchParams();
    if (input.mailboxId) {
      params.set("mailboxId", input.mailboxId);
    }
    if (input.search) {
      params.set("search", input.search);
    }
    const query = params.size ? `?${params.toString()}` : "";
    return fetchData<MailWorkspace>(`/api/v1/mail/workspace${query}`);
  },

  mutateMessage(mutation: MessageMutation) {
    return fetchData<{ readonly updated: boolean }>(
      `/api/v1/mail/messages/${encodeURIComponent(mutation.messageId)}`,
      { body: JSON.stringify(mutation), method: "PATCH" },
    );
  },

  sendMessage(input: ComposeInput) {
    return fetchData<SendReceipt>("/api/v1/mail/send", {
      body: JSON.stringify(input),
      method: "POST",
    });
  },
};

export const memberSessionApi = {
  signIn(input: MemberSignInInput) {
    return fetchData<SessionResult>("/api/v1/member/session", {
      body: JSON.stringify(input),
      method: "POST",
    });
  },

  signOut() {
    return deleteResource(
      "/api/v1/member/session",
      "Unable to sign out of this mailbox.",
    );
  },
};

export const memberSettingsApi = {
  changePassword(input: MemberPasswordInput) {
    return fetchData<{ readonly changed: boolean }>("/api/v1/member/settings", {
      body: JSON.stringify(input),
      method: "PUT",
    });
  },

  get() {
    return fetchData<MemberSettingsSnapshot>("/api/v1/member/settings");
  },

  updateProfile(displayName: string) {
    return fetchData<{ readonly profile: MemberProfile }>(
      "/api/v1/member/settings",
      {
        body: JSON.stringify({ displayName }),
        method: "PATCH",
      },
    );
  },
};

export const adminMailServiceApi = {
  get() {
    return fetchData<AdminMailServiceSnapshot>(
      "/api/v1/admin/mail-service",
    );
  },

  save(input: AdminMailServiceConfiguration) {
    return fetchData<AdminMailServiceSnapshot>(
      "/api/v1/admin/mail-service",
      {
        body: JSON.stringify(input),
        method: "PUT",
      },
    );
  },
};
