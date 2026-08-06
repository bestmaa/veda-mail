export interface ActiveSessionViewModel {
  readonly clientLabel?: string;
  readonly createdAt: string;
  readonly current?: boolean;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastSeenAt: string;
  readonly ownerReference?: string;
  readonly providerId?: string;
}

export interface AdminSessionModel {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isRevoking: string | null;
  readonly onRevoke: (id: string, kind: "administrator" | "member") => void;
  readonly snapshot: {
    readonly administrator: readonly ActiveSessionViewModel[];
    readonly member: readonly ActiveSessionViewModel[];
  } | null;
}
