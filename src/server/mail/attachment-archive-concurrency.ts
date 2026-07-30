import "server-only";

import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import { ApiError } from "@/transport/http/api-error";

const MAX_ACTIVE_ARCHIVES = 4;
const MAX_ACTIVE_ARCHIVES_PER_SUBJECT = 1;

interface ArchiveConcurrencyState {
  active: number;
  readonly subjects: Map<string, number>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailAttachmentArchiveConcurrency?: ArchiveConcurrencyState;
};

const state =
  globalState.__vedaMailAttachmentArchiveConcurrency ??
  { active: 0, subjects: new Map<string, number>() };
globalState.__vedaMailAttachmentArchiveConcurrency = state;

const archiveBusy = (): never => {
  throw new ApiError(
    "Too many attachment archives are active. Please try again shortly.",
    "ATTACHMENT_ARCHIVE_BUSY",
    429,
  );
};

export const acquireAttachmentArchiveLease = (
  subject: string,
): AttachmentDownloadLease => {
  const subjectActive = state.subjects.get(subject) ?? 0;
  if (
    state.active >= MAX_ACTIVE_ARCHIVES ||
    subjectActive >= MAX_ACTIVE_ARCHIVES_PER_SUBJECT
  ) {
    archiveBusy();
  }
  state.active += 1;
  state.subjects.set(subject, subjectActive + 1);

  let downloadLease: AttachmentDownloadLease;
  try {
    downloadLease = acquireAttachmentDownloadLease(subject);
  } catch (error) {
    state.active -= 1;
    state.subjects.delete(subject);
    throw error;
  }

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      downloadLease.release();
      state.active = Math.max(0, state.active - 1);
      const remaining = Math.max(0, (state.subjects.get(subject) ?? 1) - 1);
      if (remaining === 0) state.subjects.delete(subject);
      else state.subjects.set(subject, remaining);
    },
  };
};
