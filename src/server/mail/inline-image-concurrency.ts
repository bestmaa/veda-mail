import "server-only";

import { ApiError } from "@/transport/http/api-error";

const MAX_ACTIVE_INLINE_IMAGES = 4;
const MAX_ACTIVE_INLINE_IMAGES_PER_SUBJECT = 2;

interface InlineImageConcurrencyState {
  active: number;
  readonly subjects: Map<string, number>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailInlineImageConcurrency?: InlineImageConcurrencyState;
};

const state =
  globalState.__vedaMailInlineImageConcurrency ??
  { active: 0, subjects: new Map<string, number>() };
globalState.__vedaMailInlineImageConcurrency = state;

export interface InlineImageLease {
  release(): void;
}

export const acquireInlineImageLease = (
  subject: string,
): InlineImageLease => {
  const current = state.subjects.get(subject) ?? 0;
  if (
    state.active >= MAX_ACTIVE_INLINE_IMAGES ||
    current >= MAX_ACTIVE_INLINE_IMAGES_PER_SUBJECT
  ) {
    throw new ApiError(
      "Another inline image is still being prepared.",
      "INLINE_IMAGE_BUSY",
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
