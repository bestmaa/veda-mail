export interface MemberSessionsViewModel {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isRevoking: string | null;
  readonly onRevoke: (id: string) => void;
  readonly snapshot: {
    readonly policy: {
      readonly absoluteTtlSeconds: number;
      readonly idleTtlSeconds: number;
    };
    readonly sessions: readonly {
      readonly clientLabel?: string;
      readonly createdAt: string;
      readonly current?: boolean;
      readonly expiresAt: string;
      readonly id: string;
      readonly lastSeenAt: string;
    }[];
  } | null;
}
