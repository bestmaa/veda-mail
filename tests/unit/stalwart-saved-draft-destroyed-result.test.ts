import { describe, expect, it } from "vitest";

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { savedDraftSubmissionOutcome } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-submission-result";
import type {
  JmapMethodResponse,
  JmapResponse,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const submission = (overrides: Record<string, unknown> = {}): JmapMethodResponse => [
  "EmailSubmission/set",
  {
    accountId: "account",
    created: { submit: { id: "submission" } },
    newState: "submission-new",
    oldState: "submission-old",
    ...overrides,
  },
  "submit-saved-draft",
];

const implicit = (overrides: Record<string, unknown> = {}): JmapMethodResponse => [
  "Email/set",
  {
    accountId: "account",
    destroyed: ["send-copy"],
    newState: "sent-state",
    oldState: "copy-state",
    ...overrides,
  },
  "submit-saved-draft",
];

const response = (
  primary: JmapMethodResponse = submission(),
  emailSet: JmapMethodResponse = implicit(),
  ...extra: JmapMethodResponse[]
): JmapResponse => ({
  methodResponses: [primary, emailSet, ...extra],
  sessionState: "session",
});

const client = {
  result: StalwartJmapClient.prototype.result,
} as unknown as StalwartJmapClient;

const outcome = (value: JmapResponse) =>
  savedDraftSubmissionOutcome(
    client,
    value,
    "account",
    "send-copy",
    "copy-state",
  );

describe("Stalwart implicit destroyed-copy result", () => {
  it("accepts only the exact created copy after a strict submission", () => {
    expect(outcome(response())).toBe("accepted");
  });

  it("keeps a strict Stalwart submission authoritative when oldState is omitted", () => {
    expect(
      outcome(response(submission({ oldState: undefined }), implicit())),
    ).toBe("accepted");
  });

  it("rejects a submission result that omits newState", () => {
    expect(
      outcome(response(submission({ newState: undefined }), implicit())),
    ).toBe("uncertain");
  });

  it.each([
    ["wrong ID", implicit({ destroyed: ["other-copy"] })],
    ["multiple IDs", implicit({ destroyed: ["send-copy", "other-copy"] })],
    ["mixed update", implicit({ updated: { "send-copy": null } })],
    ["set failure", implicit({ notDestroyed: { "send-copy": { type: "forbidden" } } })],
    ["wrong account", implicit({ accountId: "other-account" })],
    ["unchanged state", implicit({ newState: "copy-state" })],
    ["discontinuous state", implicit({ oldState: "other-state" })],
  ])("does not accept %s destruction evidence", (_label, emailSet) => {
    expect(outcome(response(submission(), emailSet))).not.toBe("accepted");
  });

  it("does not accept duplicate implicit results", () => {
    expect(outcome(response(submission(), implicit(), implicit()))).not.toBe(
      "accepted",
    );
  });

  it("does not let exact destruction rescue a non-strict submission", () => {
    expect(
      outcome(response(submission({ accountId: "other-account" }), implicit())),
    ).not.toBe("accepted");
  });
});
