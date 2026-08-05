import type { ChangeEventHandler } from "react";
import type { NotificationContent } from "@/domain/mail/new-mail-notification";

export interface NewMailNotificationViewModel {
  readonly content: NotificationContent;
  readonly dismissNotice: () => void;
  readonly enable: () => void;
  readonly error: string | null;
  readonly isEnabling: boolean;
  readonly isSupported: boolean;
  readonly notice: { readonly body: string; readonly title: string } | null;
  readonly onContentChange: ChangeEventHandler<HTMLInputElement>;
  readonly permission: NotificationPermission | "unsupported";
  readonly webEnabled: boolean;
  readonly disable: () => void;
}
