import "server-only";

export {
  createReceivedAttachmentScanSpool,
  ReceivedAttachmentScanSpool,
} from "@/server/mail/received-attachment-scan-spool";
export {
  cleanupReceivedAttachmentScanOrphans,
  createReceivedAttachmentScanDirectory,
} from "@/server/mail/received-attachment-scan-cleanup";
export {
  MAX_RECEIVED_SCAN_BYTES,
  ReceivedAttachmentScanError,
  type ReceivedAttachmentScanHandle,
  type ReceivedAttachmentScanScope,
  type ReceivedAttachmentScanSnapshot,
  type ReceivedAttachmentScanSpoolOptions,
  type ReceivedAttachmentScanState,
  type StageReceivedAttachmentInput,
} from "@/server/mail/received-attachment-scan-types";
