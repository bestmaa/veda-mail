import type { MessageDetail } from "@/domain/mail/mail";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";

const inbox = id.mailbox("mock-inbox");
const archive = id.mailbox("mock-archive");
const drafts = id.mailbox("mock-drafts");
const sent = id.mailbox("mock-sent");
const roadmapAttachmentBytes = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
);

export const mockRoadmapAttachment = {
  id: id.attachment("attachment-roadmap"),
  messageId: id.message("msg-roadmap"),
  mimeType: "application/pdf",
  name: "Q3-roadmap.pdf",
} as const;

export const createMockRoadmapAttachmentBytes = (): Uint8Array =>
  roadmapAttachmentBytes.slice();

export const createMockAttachmentContents = (): Map<
  MessageId,
  Map<AttachmentId, Uint8Array>
> =>
  new Map([
    [
      mockRoadmapAttachment.messageId,
      new Map([
        [mockRoadmapAttachment.id, createMockRoadmapAttachmentBytes()],
      ]),
    ],
  ]);

export const mockMailboxIds = {
  archive,
  drafts,
  inbox,
  sent,
  spam: id.mailbox("mock-spam"),
  trash: id.mailbox("mock-trash"),
};

export const createMockMessages = (): MessageDetail[] => [
  {
    attachments: [],
    cc: [],
    from: [{ email: "noreply@stalw.art", name: "Stalwart Mail" }],
    hasAttachment: false,
    htmlBody: null,
    id: id.message("msg-welcome"),
    isStarred: true,
    isUnread: true,
    mailboxIds: [inbox],
    preview:
      "Your private mail stack is ready. Here are the next security checks.",
    receivedAt: "2026-07-23T05:42:00.000Z",
    replyTo: [],
    size: 18420,
    subject: "Your Stalwart workspace is ready",
    textBody:
      "Your private mail stack is ready.\n\nSPF, DKIM, DMARC and reverse DNS are healthy. Add your team accounts and keep credentials private.",
    threadId: id.thread("thread-welcome"),
    to: [{ email: "member@example.com", name: "Sample Member" }],
  },
  {
    attachments: [
      {
        id: mockRoadmapAttachment.id,
        mimeType: mockRoadmapAttachment.mimeType,
        name: mockRoadmapAttachment.name,
        size: roadmapAttachmentBytes.byteLength,
      },
    ],
    cc: [{ email: "owner@example.com", name: "Owner" }],
    from: [{ email: "priya@northstar.design", name: "Priya Menon" }],
    hasAttachment: true,
    htmlBody: null,
    id: mockRoadmapAttachment.messageId,
    isStarred: false,
    isUnread: true,
    mailboxIds: [inbox],
    preview: "I added the revised delivery milestones and ownership notes.",
    receivedAt: "2026-07-23T04:18:00.000Z",
    replyTo: [],
    size: 2_455_000,
    subject: "Revised product roadmap · Q3",
    textBody:
      "Hi team,\n\nI added the revised delivery milestones and ownership notes. Please review the yellow callouts before tomorrow's sync.\n\nPriya",
    threadId: id.thread("thread-roadmap"),
    to: [{ email: "member@example.com", name: "Sample Member" }],
  },
  {
    attachments: [],
    cc: [],
    from: [{ email: "security@cloudflare.com", name: "Cloudflare" }],
    hasAttachment: false,
    htmlBody: null,
    id: id.message("msg-dns"),
    isStarred: true,
    isUnread: false,
    mailboxIds: [inbox],
    preview: "The DNS changes for example.com have propagated globally.",
    receivedAt: "2026-07-22T18:04:00.000Z",
    replyTo: [],
    size: 21950,
    subject: "DNS records are now active",
    textBody:
      "The DNS changes for example.com have propagated globally. Your MX, SPF and DKIM records are being served from all edge locations.",
    threadId: id.thread("thread-dns"),
    to: [{ email: "member@example.com", name: null }],
  },
  {
    attachments: [],
    cc: [],
    from: [{ email: "vikram@acme.in", name: "Vikram Shah" }],
    hasAttachment: false,
    htmlBody: null,
    id: id.message("msg-kickoff"),
    isStarred: false,
    isUnread: false,
    mailboxIds: [inbox],
    preview: "Tuesday at 3 PM works for our product and engineering leads.",
    receivedAt: "2026-07-22T12:22:00.000Z",
    replyTo: [],
    size: 14310,
    subject: "Project kickoff — Tuesday confirmed",
    textBody:
      "Hello Aditya,\n\nTuesday at 3 PM works for our product and engineering leads. Please share the agenda when ready.\n\nRegards,\nVikram",
    threadId: id.thread("thread-kickoff"),
    to: [{ email: "member@example.com", name: "Sample Member" }],
  },
  {
    attachments: [],
    cc: [],
    from: [{ email: "billing@contabo.com", name: "Contabo" }],
    hasAttachment: false,
    htmlBody: null,
    id: id.message("msg-vps"),
    isStarred: false,
    isUnread: false,
    mailboxIds: [archive],
    preview: "Your Cloud VPS 6 invoice is available in the customer panel.",
    receivedAt: "2026-07-21T08:35:00.000Z",
    replyTo: [],
    size: 34890,
    subject: "Invoice available for Cloud VPS 6",
    textBody:
      "Your Cloud VPS 6 invoice is available in the customer panel. No action is required if automatic payment is enabled.",
    threadId: id.thread("thread-vps"),
    to: [{ email: "member@example.com", name: null }],
  },
  {
    attachments: [],
    cc: [],
    from: [{ email: "member@example.com", name: "Sample Member" }],
    hasAttachment: false,
    htmlBody: null,
    id: id.message("msg-sent"),
    isStarred: false,
    isUnread: false,
    mailboxIds: [sent],
    preview:
      "Thank you for the discovery session. Here is the proposed architecture.",
    receivedAt: "2026-07-20T11:14:00.000Z",
    replyTo: [],
    size: 19220,
    subject: "Architecture proposal and next steps",
    textBody:
      "Hi team,\n\nThank you for the discovery session. Here is the proposed architecture and the delivery sequence we discussed.\n\nBest,\nSample Member",
    threadId: id.thread("thread-proposal"),
    to: [{ email: "founder@sample.co", name: "Rohan" }],
  },
  {
    attachments: [],
    cc: [],
    from: [{ email: "member@example.com", name: "Sample Member" }],
    hasAttachment: false,
    htmlBody: null,
    id: id.message("msg-draft"),
    isStarred: false,
    isUnread: false,
    mailboxIds: [drafts],
    preview: "Sharing the initial delivery plan for your review.",
    receivedAt: "2026-07-19T09:05:00.000Z",
    replyTo: [],
    size: 8040,
    subject: "Draft: delivery plan",
    textBody: "Hi Maya,\n\nSharing the initial delivery plan for your review.",
    threadId: id.thread("thread-draft"),
    to: [{ email: "maya@example.com", name: "Maya" }],
  },
];
