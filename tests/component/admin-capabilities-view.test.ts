import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AdminCapabilitiesViewProps } from "@/presentation/features/admin-capabilities/admin-capabilities.view-model";
import { AdminCapabilitiesView } from "@/presentation/features/admin-capabilities/ui/admin-capabilities.view";

const model: AdminCapabilitiesViewProps = {
  capabilities: [
    {
      effective: true,
      effectiveLabel: "Available",
      id: "member-profile",
      label: "Member profile editing",
      organizationLabel: "Enabled",
      providerLabel: "Available",
    },
    {
      effective: false,
      effectiveLabel: "Unavailable",
      id: "provider-drafts",
      label: "Provider-backed drafts",
      organizationLabel: "Not controlled",
      providerLabel: "Unavailable",
    },
  ],
  error: null,
  isLoading: false,
  isSaving: false,
  onSubmit: vi.fn(),
  policyControls: [
    {
      checked: true,
      description: "Allow members to update their display name.",
      id: "memberProfileEditing",
      label: "Member profile editing",
      onChange: vi.fn(),
    },
  ],
  providerName: "Stalwart JMAP",
  success: null,
};

describe("admin capabilities view", () => {
  it("renders the provider, organization, and effective matrix", () => {
    const html = renderToStaticMarkup(
      createElement(AdminCapabilitiesView, model),
    );

    expect(html).toContain("Stalwart JMAP");
    expect(html).toContain("Provider-backed drafts");
    expect(html).toContain("Not controlled");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Save policy");
  });
});
