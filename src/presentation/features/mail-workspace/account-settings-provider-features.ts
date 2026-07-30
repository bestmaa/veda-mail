import { formatFileSize } from "@/presentation/shared/formatters/mail-formatters";
import type { MemberSettingsSnapshot } from "@/transport/client/api-client";

type Capabilities = MemberSettingsSnapshot["capabilities"];

const availability = (supported: boolean): string =>
  supported ? "Available" : "Not available";

export const createProviderFeatures = (
  capabilities: Capabilities,
  attachmentStatus?: MemberSettingsSnapshot["attachmentCapability"]["status"],
) => [
  {
    detail: availability(capabilities.mail.supportsServerSearch),
    label: "Server-side search",
    supported: capabilities.mail.supportsServerSearch,
  },
  {
    detail: availability(capabilities.mail.supportsDrafts),
    label: "Provider draft sync",
    supported: capabilities.mail.supportsDrafts,
  },
  {
    detail: availability(capabilities.mail.supportsThreads),
    label: "Conversation threads",
    supported: capabilities.mail.supportsThreads,
  },
  {
    detail: capabilities.mail.supportsPush ? "Available" : "Manual refresh",
    label: "Live mailbox updates",
    supported: capabilities.mail.supportsPush,
  },
  {
    detail:
      attachmentStatus === "unavailable"
        ? "Temporarily unavailable"
        : capabilities.mail.maxAttachmentBytes > 0
          ? `Up to ${formatFileSize(capabilities.mail.maxAttachmentBytes)}`
          : "Not available",
    label: "Attachment upload & send",
    supported: capabilities.mail.maxAttachmentBytes > 0,
  },
  {
    detail:
      capabilities.mail.supportsAttachmentDownload &&
      capabilities.mail.maxAttachmentDownloadBytes > 0
        ? `Up to ${formatFileSize(
            capabilities.mail.maxAttachmentDownloadBytes,
          )}`
        : "Not available",
    label: "Received attachment downloads",
    supported:
      capabilities.mail.supportsAttachmentDownload &&
      capabilities.mail.maxAttachmentDownloadBytes > 0,
  },
] as const;
