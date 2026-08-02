import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ComposerScheduleViewModel } from "@/presentation/features/mail-workspace/composer-schedule.view-model";
import { ComposerScheduleDialogView } from "@/presentation/features/mail-workspace/ui/composer-schedule-dialog.view";

const schedule = (
  overrides: Partial<ComposerScheduleViewModel> = {},
): ComposerScheduleViewModel => ({
  error: null,
  isAvailable: true,
  isOpen: true,
  isScheduling: false,
  localTime: "2026-08-03T09:00",
  maximum: "2027-08-03T09:00",
  minimum: "2026-08-02T09:00",
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  onOpen: vi.fn(),
  onTimeInput: vi.fn(),
  timeZone: "Asia/Calcutta",
  ...overrides,
});

describe("composer schedule dialog", () => {
  it("exposes modal semantics, bounded local time, and durable behavior", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerScheduleDialogView,
      { schedule: schedule() },
    ));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('min="2026-08-02T09:00"');
    expect(html).toContain('max="2027-08-03T09:00"');
    expect(html).toContain("even after you close the browser");
    expect(html).toContain("Asia/Calcutta");
  });

  it("announces errors and locks both actions during persistence", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerScheduleDialogView,
      { schedule: schedule({ error: "Save failed", isScheduling: true }) },
    ));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Save failed");
    expect(html.match(/disabled=""/gu)).toHaveLength(3);
    expect(html).toContain("Scheduling…");
  });
});
