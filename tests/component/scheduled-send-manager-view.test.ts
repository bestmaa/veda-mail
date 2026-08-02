import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { ScheduledSendManagerViewModel } from "@/presentation/features/mail-workspace/scheduled-send-manager.view-model";
import { ScheduledSendManagerView } from "@/presentation/features/mail-workspace/ui/scheduled-send-manager.view";

const manager = (
  overrides: Partial<ScheduledSendManagerViewModel> = {},
): ScheduledSendManagerViewModel => ({
  count: 1, error: null, isAvailable: true, isLoading: false, isMutating: false, isOpen: true,
  messages: [{
    attemptCount: 1, createdAt: "2026-08-02T08:00:00.000Z",
    id: id.scheduledMessage("11111111-1111-4111-8111-111111111111"),
    lastError: null, recipientCount: 2, scheduledAt: "2026-08-03T08:00:00.000Z",
    status: "retrying", subject: "Team update", updatedAt: "2026-08-02T08:05:00.000Z",
  }],
  onCancelMessage: vi.fn(), onClose: vi.fn(), onConfirmReschedule: vi.fn(),
  onOpen: vi.fn(), onRequestReschedule: vi.fn(), onRescheduleCancel: vi.fn(),
  onRescheduleTimeInput: vi.fn(), onRetry: vi.fn(), rescheduleError: null,
  rescheduleMaximum: "2027-08-02T10:00", rescheduleMinimum: "2026-08-02T10:00",
  rescheduleTarget: null, rescheduleTime: "", timeZone: "Asia/Calcutta",
  ...overrides,
});

describe("scheduled-send manager", () => {
  it("renders status, recipients, time, and management actions accessibly", () => {
    const html = renderToStaticMarkup(createElement(
      ScheduledSendManagerView,
      { manager: manager() },
    ));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Team update");
    expect(html).toContain("2 recipients");
    expect(html).toContain("Retrying · attempt 1");
    expect(html).toContain("Reschedule");
    expect(html).toContain('aria-label="Cancel scheduled message"');
  });

  it("does not advertise cancel or retry for an in-flight send", () => {
    const current = manager();
    const html = renderToStaticMarkup(createElement(
      ScheduledSendManagerView,
      { manager: manager({ messages: [{ ...current.messages[0]!, status: "sending" }] }) },
    ));
    expect(html).toContain("Sending");
    expect(html).not.toContain("Reschedule");
    expect(html).not.toContain("Cancel scheduled message");
  });

  it("labels ambiguous records as review-only", () => {
    const current = manager();
    const html = renderToStaticMarkup(createElement(
      ScheduledSendManagerView,
      { manager: manager({ messages: [{
        ...current.messages[0]!, lastError: "Delivery outcome needs review.",
        status: "uncertain",
      }] }) },
    ));
    expect(html).toContain("Needs review");
    expect(html).toContain('aria-label="Remove review record"');
    expect(html).not.toContain("Reschedule");
  });
});
