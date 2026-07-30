import "server-only";

import { ApiError } from "@/transport/http/api-error";

const MAX_ACTIVE_PREVIEWS = 2;
const MAX_ACTIVE_PREVIEWS_PER_SUBJECT = 1;

interface PreviewConcurrencyState {
  active: number;
  readonly subjects: Map<string, number>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailAttachmentPreviewConcurrency?: PreviewConcurrencyState;
};

const state =
  globalState.__vedaMailAttachmentPreviewConcurrency ??
  { active: 0, subjects: new Map<string, number>() };
globalState.__vedaMailAttachmentPreviewConcurrency = state;

export interface AttachmentPreviewLease {
  release(): void;
}

export const acquireAttachmentPreviewLease = (
  subject: string,
): AttachmentPreviewLease => {
  const current = state.subjects.get(subject) ?? 0;
  if (
    state.active >= MAX_ACTIVE_PREVIEWS ||
    current >= MAX_ACTIVE_PREVIEWS_PER_SUBJECT
  ) {
    throw new ApiError(
      "Another attachment preview is still being prepared.",
      "ATTACHMENT_PREVIEW_BUSY",
      429,
    );
  }
  state.active += 1;
  state.subjects.set(subject, current + 1);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      const remaining = Math.max(0, (state.subjects.get(subject) ?? 1) - 1);
      if (remaining === 0) state.subjects.delete(subject);
      else state.subjects.set(subject, remaining);
    },
  };
};
