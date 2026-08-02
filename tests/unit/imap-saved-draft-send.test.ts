import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { ImapDraftStore } from "@/infrastructure/providers/imap-smtp/imap-draft.store";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
import { ImapSmtpMailGateway } from "@/infrastructure/providers/imap-smtp/imap-mail.gateway";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "provider-secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "member@example.com",
};
const content: DraftContent = {
  bcc: [],
  body: "Authoritative provider body",
  cc: [],
  subject: "Saved draft",
  to: [{ email: "recipient@example.com", name: null }],
};
const detail: DraftDetail = {
  composeId: id.draft("11111111-1111-4111-8111-111111111111"),
  content,
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: id.providerDraft("provider-draft"),
  revision: "draft-revision",
  updatedAt: "2026-08-02T09:00:00.000Z",
};
const input = (overrides: Partial<SendMessageInput> = {}): SendMessageInput => ({
  ...content,
  providerDraft: {
    composeId: detail.composeId!,
    expectedRevision: detail.revision,
    id: detail.id,
  },
  ...overrides,
});
const receipt = (deliveryStatus: SendReceipt["deliveryStatus"]): SendReceipt => ({
  deliveryStatus,
  id: id.message("sent-message"),
  rejectedRecipients: [],
  submittedAt: "2026-08-02T09:01:00.000Z",
});

let prepare: ReturnType<typeof vi.spyOn>;
let discard: ReturnType<typeof vi.spyOn>;
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  prepare = vi
    .spyOn(ImapDraftStore.prototype, "prepareSend")
    .mockResolvedValue(detail);
  discard = vi
    .spyOn(ImapDraftStore.prototype, "discard")
    .mockResolvedValue(undefined);
  send = vi
    .spyOn(ImapMailWriter.prototype, "sendMessage")
    .mockResolvedValue(receipt("accepted"));
});

describe("IMAP saved draft submission", () => {
  it("submits only content matching the authoritative provider draft", async () => {
    const gateway = new ImapSmtpMailGateway(config);

    await expect(
      gateway.sendMessage(input({ body: "forged browser body" })),
    ).rejects.toMatchObject({ name: "DraftConflictError" });

    expect(prepare).toHaveBeenCalledWith(input().providerDraft);
    expect(send).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it("deletes the exact saved draft after accepted delivery", async () => {
    const gateway = new ImapSmtpMailGateway(config);

    await expect(gateway.sendMessage(input())).resolves.toEqual(receipt("accepted"));

    expect(send).toHaveBeenCalledWith(input());
    expect(discard).toHaveBeenCalledWith(detail.id, detail.revision);
  });

  it("keeps the saved draft when SMTP delivery is uncertain", async () => {
    send.mockResolvedValueOnce(receipt("uncertain"));
    const gateway = new ImapSmtpMailGateway(config);

    await expect(gateway.sendMessage(input())).resolves.toEqual(receipt("uncertain"));

    expect(discard).not.toHaveBeenCalled();
  });
});
