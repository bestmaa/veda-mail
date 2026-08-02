import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>(); const values: unknown[] = []; let cursor = 0;
  return {
    begin: () => { cursor = 0; },
    reset: () => { cursor = 0; initialized.clear(); values.length = 0; },
    useState: <T,>(initial: T | (() => T)): readonly [T, (next: T) => void] => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [values[index] as T, (next) => { values[index] = next; }];
    },
  };
});
const api = vi.hoisted(() => ({ scheduleMessage: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useState: hooks.useState,
}));
vi.mock("@/transport/client/api-client", () => ({ mailApi: api }));
vi.mock("@/presentation/shared/hooks/use-modal-dialog-focus", () => ({
  useModalDialogFocus: vi.fn(),
}));

import { id } from "@/domain/shared/brand";
import { localDateTimeValue } from "@/presentation/features/mail-workspace/composer-schedule-time";
import { useComposerSchedule } from "@/presentation/features/mail-workspace/hooks/use-composer-schedule";

const saved = {
  attachments: [],
  composeId: id.draft("11111111-1111-4111-8111-111111111111"),
  content: { bcc: [], body: "Body", cc: [], subject: "Subject", to: [] },
  hasAttachments: false, hasTruncatedContent: false,
  hasUncertainSubmission: false, id: id.providerDraft("provider-draft"),
  revision: "revision-1", updatedAt: "2026-08-02T08:00:00.000Z",
};
const futureLocal = () => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1_000));
const options = (overrides: Record<string, unknown> = {}) => ({
  attachments: {
    expireReady: vi.fn(() => false), hasError: false, isUploading: false,
  },
  body: { payload: { body: "Body" }, text: "Body" },
  draft: { saveDetail: vi.fn(async () => saved) },
  enabled: true,
  fields: {
    bcc: "", cc: "", inReplyTo: null, subject: "Subject",
    to: "recipient@example.com",
  },
  handleSessionFailure: vi.fn(() => false),
  isAccountCurrent: vi.fn(() => true),
  onScheduled: vi.fn(async () => undefined),
  openAccountKey: "session-scope",
  ...overrides,
});
const render = (value: ReturnType<typeof options>) => {
  hooks.begin();
  return useComposerSchedule(value as never);
};

beforeEach(() => { hooks.reset(); vi.clearAllMocks(); api.scheduleMessage.mockResolvedValue({ messages: [], revision: "r", version: 1 }); });

describe("composer scheduled send", () => {
  it("forces a provider draft save before creating the durable queue job", async () => {
    const value = options();
    let schedule = render(value);
    schedule.open(); schedule = render(value);
    schedule.onTimeInput({ currentTarget: { value: futureLocal() } } as never);
    schedule = render(value);
    await schedule.confirm();
    expect(value.draft.saveDetail).toHaveBeenCalledOnce();
    expect(api.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentIds: [], draftId: saved.composeId,
        expectedDraftRevision: saved.revision, providerDraftId: saved.id,
        to: [{ email: "recipient@example.com", name: null }],
      }),
      expect.stringMatching(/Z$/u),
      "session-scope",
    );
    expect(value.onScheduled).toHaveBeenCalledOnce();
  });

  it("blocks missing recipients and unavailable durable storage before saving", async () => {
    const noRecipient = options({
      fields: { bcc: "", cc: "", inReplyTo: null, subject: "", to: "" },
    });
    let schedule = render(noRecipient);
    await schedule.confirm();
    schedule = render(noRecipient);
    expect(schedule.error).toBe("Add at least one recipient.");
    expect(noRecipient.draft.saveDetail).not.toHaveBeenCalled();
    hooks.reset();
    const disabled = render(options({ enabled: false }));
    disabled.open();
    expect(render(options({ enabled: false })).isOpen).toBe(false);
  });

  it("keeps the composer open when the provider draft cannot be secured", async () => {
    const value = options({ draft: { saveDetail: vi.fn(async () => null) } });
    let schedule = render(value);
    schedule.onTimeInput({ currentTarget: { value: futureLocal() } } as never);
    schedule = render(value);
    await schedule.confirm();
    schedule = render(value);
    expect(schedule.error).toContain("Save the draft");
    expect(api.scheduleMessage).not.toHaveBeenCalled();
  });
});
