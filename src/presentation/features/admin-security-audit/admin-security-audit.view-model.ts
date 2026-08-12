export interface AdminSecurityAuditItem {
  readonly action: string;
  readonly actor: string;
  readonly count: string | null;
  readonly id: string;
  readonly outcome: string;
  readonly requestId: string | null;
  readonly target: string | null;
  readonly timestamp: string;
}

export interface AdminSecurityAuditViewProps {
  readonly droppedCount: number;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly isSavingRetention: boolean;
  readonly items: readonly AdminSecurityAuditItem[];
  readonly nextCursor: number | null;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onSaveRetention: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly retention: {
    readonly maxAgeDays: number;
    readonly maxEntries: number;
    readonly onMaxAgeDays: (value: number) => void;
    readonly onMaxEntries: (value: number) => void;
  };
  readonly retentionSuccess: string | null;
  readonly verifiedAt: string | null;
}
