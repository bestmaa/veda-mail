import type { MemberSettingsSnapshot } from "@/transport/client/api-client";

export const DEFAULT_MEMBER_CAPABILITIES = {
  mail: {
    maxAttachmentBytes: 0,
    maxAttachmentDownloadBytes: 0,
    supportsAttachmentDownload: false,
    supportsDrafts: false,
    supportsPasswordChange: false,
    supportsProfileSettings: false,
    supportsPush: false,
    supportsServerSearch: false,
    supportsThreads: false,
    supportsTwoFactorAuthentication: false,
  },
  passwordChange: false,
  profileSettings: false,
  twoFactorAuthentication: false,
} satisfies MemberSettingsSnapshot["capabilities"];
