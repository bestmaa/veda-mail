export interface BackupRestoreDrillInput {
  readonly sourceDirectory: string;
  readonly workDirectory: string;
}

export interface BackupRestoreDrillReport {
  readonly archive: string;
  readonly archiveSha256: string;
  readonly byteCount: number;
  readonly completedAt: string;
  readonly entryCount: number;
  readonly manifestSha256: string;
  readonly restoredDirectory: string;
  readonly version: 1;
}

export declare const runBackupRestoreDrill: (
  input: BackupRestoreDrillInput,
) => Promise<BackupRestoreDrillReport>;
