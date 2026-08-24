export interface AdminMailUserSummary {
  readonly aliases: readonly string[];
  readonly createdAt: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly id: string;
  readonly maxDiskQuota: number | null;
  readonly usedDiskQuota: number;
}

export interface AdminMailUserDetail extends AdminMailUserSummary {
  readonly lifecycle?: MailUserLifecycleCapability;
  readonly locale: string | null;
  readonly timeZone: string | null;
}

export interface MailUserLifecycleCapability {
  readonly available: boolean;
  readonly protected: boolean;
  readonly reason: "protected-account" | null;
}

export interface AdminMailUserPage {
  readonly items: readonly AdminMailUserSummary[];
  readonly nextCursor?: string;
}

export type MailUserCreationAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: "domain-disabled" | "external-directory";
    };

export interface AdminMailUserCreateResult {
  readonly outcome: "created";
  readonly user: AdminMailUserDetail;
  readonly warning?: "cache-invalidation-failed";
}

export interface AdminMailUserLifecycleResult {
  readonly email: string;
  readonly forwardingRemoved: boolean;
  readonly outcome: "disabled" | "deleted";
  readonly sessionsRevoked: number;
  readonly userId: string;
}

export type AdminMailUserOperationResult =
  | AdminMailUserCreateResult
  | AdminMailUserLifecycleResult;

export type MailUserAdministrationErrorCode =
  | "configuration"
  | "create-outcome-unknown"
  | "lifecycle-outcome-unknown"
  | "domain-disabled"
  | "domain-not-found"
  | "duplicate"
  | "external-directory"
  | "invalid-input"
  | "not-found"
  | "protected-account"
  | "provider-auth"
  | "provider-response"
  | "provider-unavailable";

export class MailUserAdministrationError extends Error {
  public constructor(
    public readonly code: MailUserAdministrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MailUserAdministrationError";
  }
}
