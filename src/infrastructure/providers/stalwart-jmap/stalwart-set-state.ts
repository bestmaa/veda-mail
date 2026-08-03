import "server-only";

interface JmapSetState {
  readonly newState?: string | null | undefined;
  readonly oldState?: string | null | undefined;
}

export const hasAdvancedJmapSetState = (
  result: JmapSetState,
  expectedOldState?: string,
): boolean =>
  typeof result.oldState === "string" &&
  typeof result.newState === "string" &&
  (expectedOldState === undefined || result.oldState === expectedOldState) &&
  result.newState !== result.oldState;

export const hasCreatedSubmissionState = (result: JmapSetState): boolean =>
  typeof result.newState === "string" &&
  (result.oldState === undefined ||
    (typeof result.oldState === "string" &&
      result.newState !== result.oldState));

export const hasUnchangedJmapSetState = (
  result: JmapSetState,
  expectedState?: string,
): boolean =>
  typeof result.oldState === "string" &&
  result.newState === result.oldState &&
  (expectedState === undefined || result.oldState === expectedState);
