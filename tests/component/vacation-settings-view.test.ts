import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { VacationSettingsViewModel } from "@/presentation/features/mail-workspace/vacation-settings.view-model";
import { VacationSettingsView } from "@/presentation/features/mail-workspace/ui/vacation-settings.view";

const model = (overrides: Partial<VacationSettingsViewModel> = {}): VacationSettingsViewModel => ({
  capabilityReason: null, delegationAccess: "read", delegationAccessInput: vi.fn(),
  delegationEntries: [], delegationIdentifier: "", delegationIdentifierInput: vi.fn(),
  delegationReason: "Mail delegation is unavailable.",
  error: null, fromDate: "", fromDateInput: vi.fn(), isEnabled: false,
  isDelegationSaving: false, isDelegationSupported: false,
  isLoading: false, isSaving: false, isSupported: true,
  onDelegationDelete: vi.fn(), onDelegationSubmit: vi.fn(),
  onEnabledChange: vi.fn(), onSubmit: vi.fn(), subject: "", subjectInput: vi.fn(),
  success: null, textBody: "", textBodyInput: vi.fn(), toDate: "",
  toDateInput: vi.fn(), ...overrides,
});

describe("vacation settings view", () => {
  it("renders accessible, bounded provider-managed controls", () => {
    const html = renderToStaticMarkup(createElement(VacationSettingsView, {
      settings: model({ isEnabled: true, subject: "Away", textBody: "Back soon" }),
    }));
    expect(html).toContain("Automatic vacation reply");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('maxLength="998"');
    expect(html).toContain('maxLength="32000"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("Mail delegation is unavailable.");
  });

  it("renders capability-gated Inbox delegates without implying send-as", () => {
    const html = renderToStaticMarkup(createElement(VacationSettingsView, {
      settings: model({ delegationEntries: [{ access: "read", identifier: "peer@example.com" }],
        delegationReason: null, isDelegationSupported: true }),
    }));
    expect(html).toContain("Inbox delegation");
    expect(html).toContain("does not grant send-as identity");
    expect(html).toContain("peer@example.com");
    expect(html).toContain("Read only");
  });

  it("disables controls and explains an unsupported provider", () => {
    const html = renderToStaticMarkup(createElement(VacationSettingsView, {
      settings: model({ capabilityReason: "Provider capability missing.", isSupported: false }),
    }));
    expect(html).toContain("Provider capability missing.");
    expect(html).toContain('<fieldset class="space-y-3" disabled=""');
    expect(html).toContain('disabled="" type="submit"');
  });
});
