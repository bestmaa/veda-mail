import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MAX_PARTIAL_DELIVERY_RECIPIENTS } from "@/presentation/features/mail-workspace/partial-delivery-notice";
import { PartialDeliveryNoticeView } from "@/presentation/features/mail-workspace/ui/partial-delivery-notice.view";

describe("partial delivery notice component", () => {
  it("politely announces only rejected recipients with retry guidance", () => {
    const html = renderToStaticMarkup(
      createElement(PartialDeliveryNoticeView, {
        notice: {
          dismissError: null,
          isDismissing: false,
          kind: "partial",
          onDismiss: vi.fn(),
          pendingCount: 2,
          rejectedRecipients: [
            "first-rejected@example.com",
            "second-rejected@example.com",
          ],
        },
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("Send a new message only to these addresses:");
    expect(html).toContain(
      "If you already retried them, dismiss this notice.",
    );
    expect(html).toContain("first-rejected@example.com");
    expect(html).toContain("second-rejected@example.com");
    expect(html).not.toContain("accepted@example.com");
    expect(html).toContain("2 delivery notices need review.");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(
      'aria-label="Rejected recipients. Use arrow keys to scroll."',
    );
    expect(html).toContain('aria-label="Dismiss delivery warning"');
  });

  it("renders the bounded maximum recipient list in a keyboard-scrollable region", () => {
    const recipients = Array.from(
      { length: MAX_PARTIAL_DELIVERY_RECIPIENTS },
      (_, index) => `recipient-${index}@example.com`,
    );
    const html = renderToStaticMarkup(
      createElement(PartialDeliveryNoticeView, {
        notice: {
          dismissError: null,
          isDismissing: false,
          kind: "partial",
          onDismiss: vi.fn(),
          pendingCount: 1,
          rejectedRecipients: recipients,
        },
        placement: "composer",
      }),
    );

    expect(html.match(/recipient-\d+@example\.com/g)).toHaveLength(
      MAX_PARTIAL_DELIVERY_RECIPIENTS,
    );
    expect(html).toContain("mx-3 mt-3 shrink-0");
    expect(html).not.toContain("fixed inset-x-3");
  });

  it("warns about uncertain delivery without rendering recipients", () => {
    const html = renderToStaticMarkup(
      createElement(PartialDeliveryNoticeView, {
        notice: {
          dismissError: null,
          isDismissing: false,
          kind: "uncertain",
          onDismiss: vi.fn(),
          pendingCount: 1,
        },
      }),
    );

    expect(html).toContain('aria-label="Uncertain delivery warning"');
    expect(html).toContain("Delivery status could not be verified");
    expect(html).toContain(
      "Check your Sent folder or mail provider before retrying.",
    );
    expect(html).not.toContain("Rejected recipients");
    expect(html).not.toContain("@example.com");
  });

  it("announces bounded queue overflow without exposing recipients", () => {
    const html = renderToStaticMarkup(
      createElement(PartialDeliveryNoticeView, {
        notice: {
          dismissError: null,
          isDismissing: false,
          kind: "overflow",
          onDismiss: vi.fn(),
          pendingCount: 100,
        },
      }),
    );

    expect(html).toContain('aria-label="Delivery notice overflow warning"');
    expect(html).toContain("Additional delivery outcomes weren’t retained.");
    expect(html).toContain("Review your Sent folder or mail provider");
    expect(html).not.toContain("Rejected recipients");
  });

  it("shows a failed persistence dismissal and locks duplicate dismissal", () => {
    const html = renderToStaticMarkup(
      createElement(PartialDeliveryNoticeView, {
        notice: {
          dismissError:
            "This delivery notice could not be dismissed. Try again.",
          isDismissing: true,
          kind: "uncertain",
          onDismiss: vi.fn(),
          pendingCount: 1,
        },
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("could not be dismissed");
    expect(html).toContain('disabled=""');
  });
});
