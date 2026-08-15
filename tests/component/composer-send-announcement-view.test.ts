import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerSendAnnouncementView } from "@/presentation/features/mail-workspace/ui/composer-send-announcement.view";

describe("composer send announcement", () => {
  it("keeps the successful send status mounted after the composer closes", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerSendAnnouncementView,
      { announcement: "Message sent." },
    ));

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Message sent.");
  });
});
