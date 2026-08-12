export interface DataRetentionPolicy {
  readonly securityAuditMaxAgeDays: number;
  readonly securityAuditMaxEntries: number;
}

export const DEFAULT_DATA_RETENTION_POLICY: DataRetentionPolicy = {
  securityAuditMaxAgeDays: 365,
  securityAuditMaxEntries: 10_000,
};
