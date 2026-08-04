import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MailSnoozeViewModel } from "@/presentation/features/mail-workspace/mail-snooze.view-model";
import { MailSnoozeDialogView } from "@/presentation/features/mail-workspace/ui/mail-snooze-dialog.view";
import { SnoozedManagerView } from "@/presentation/features/mail-workspace/ui/snoozed-manager.view";

const model = (): MailSnoozeViewModel => ({
  canSnoozeBulk: true, canSnoozeReader: true,
  dialog: { confirmLabel: "Snooze", error: null, isBusy: false, isOpen: true,
    localTime: "2026-08-05T08:00", maximum: "2027-08-05T08:00", minimum: "2026-08-04T08:01",
    onCancel: vi.fn(), onConfirm: vi.fn(), onPreset: vi.fn(), onTimeInput: vi.fn(),
    presets: [{ id: "tomorrow", label: "Tomorrow", resolved: "5 Aug, 8:00 am", value: "2026-08-05T08:00" }],
    resolvedUtc: "2026-08-05T02:30:00.000Z", targetLabel: "Snooze “Invoice”", timeZone: "Asia/Calcutta" },
  error: null, isBusy: false, isLoading: false,
  jobs: [{ attemptCount: 0, createdAt: "2026-08-04T00:00:00.000Z", from: ["billing@example.com"],
    id: "job-1", lastError: null, messageId: "message-1" as never, status: "snoozed",
    statusLabel: "Snoozed", subject: "Invoice", updatedAt: "2026-08-04T00:00:00.000Z",
    wakeAt: "2026-08-05T02:30:00.000Z", wakeLabel: "5 Aug, 8:00 am" }],
  manager: { close: vi.fn(), isOpen: true, open: vi.fn() },
  onOpenBulk: vi.fn(), onOpenReader: vi.fn(), onReschedule: vi.fn(), onRestore: vi.fn(), onRetry: vi.fn(),
  pendingMessageIds: new Set(), snoozedMailboxId: "snoozed", supported: true,
});

describe("mail snooze views", () => {
  it("renders an accessible local-time dialog with resolved UTC", () => {
    const html = renderToStaticMarkup(createElement(MailSnoozeDialogView, { snooze: model() }));
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
    expect(html).toContain('type="datetime-local"'); expect(html).toContain("Asia/Calcutta");
    expect(html).toContain("2026-08-05T02:30:00.000Z"); expect(html).toContain("Tomorrow");
  });

  it("renders job status and restore/change-time actions", () => {
    const html = renderToStaticMarkup(createElement(SnoozedManagerView, { snooze: model() }));
    expect(html).toContain("Invoice"); expect(html).toContain("Restore now");
    expect(html).toContain("Change time"); expect(html).toContain("billing@example.com");
  });
});
