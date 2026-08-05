import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NewMailNotificationViewModel } from "@/presentation/features/mail-workspace/new-mail-notification.view-model";
import { NewMailNotificationNoticeView } from "@/presentation/features/mail-workspace/ui/new-mail-notification-notice.view";
import { NewMailNotificationSettingsView } from "@/presentation/features/mail-workspace/ui/new-mail-notification-settings.view";

const model = (
  overrides: Partial<NewMailNotificationViewModel> = {},
): NewMailNotificationViewModel => ({
  content: "private",
  disable: vi.fn(),
  dismissNotice: vi.fn(),
  enable: vi.fn(),
  error: null,
  isEnabling: false,
  isSupported: true,
  notice: null,
  onContentChange: vi.fn(),
  permission: "default",
  webEnabled: false,
  ...overrides,
});

describe("new mail notification views", () => {
  it("explains privacy and presents a non-coercive enable action", () => {
    const html = renderToStaticMarkup(createElement(
      NewMailNotificationSettingsView,
      { notifications: model() },
    ));
    expect(html).toContain("Private (recommended)");
    expect(html).toContain("Permission is requested only when you choose Enable");
    expect(html).toContain(">Enable<");
    expect(html).toContain("never notification message content");
  });

  it("renders an accessible, dismissible in-app notice", () => {
    const html = renderToStaticMarkup(createElement(
      NewMailNotificationNoticeView,
      { notifications: model({ notice: { body: "You have a new message.",
        title: "New mail in Veda Mail" } }) },
    ));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Dismiss new-mail notification"');
  });
});
