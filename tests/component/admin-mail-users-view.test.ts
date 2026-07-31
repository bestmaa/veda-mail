import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AdminMailUsersViewProps } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import { AdminMailUsersView } from "@/presentation/features/admin-mail-users/ui/admin-mail-users.view";

const model = (
  overrides: Partial<AdminMailUsersViewProps> = {},
): AdminMailUsersViewProps => ({
  capabilityDescription: null,
  capabilityTitle: null,
  create: {
    adminPassword: "",
    adminPasswordInput: vi.fn(),
    confirmation: "",
    confirmationInput: vi.fn(),
    displayName: "",
    displayNameInput: vi.fn(),
    domain: "example.com",
    email: "",
    emailInput: vi.fn(),
    isAvailable: true,
    isSubmitting: false,
    mailboxPassword: "",
    mailboxPasswordInput: vi.fn(),
    onSubmit: vi.fn(),
    otpCode: "",
    otpCodeInput: vi.fn(),
    reason: null,
    requiresOtp: true,
  },
  detail: {
    aliases: ["alias@example.com"],
    createdLabel: "Jul 31, 2026",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    locale: "en",
    storageLabel: "1 KiB of 10 KiB",
    timeZone: "Asia/Calcutta",
  },
  domainInput: vi.fn(),
  domains: ["example.com"],
  error: null,
  isDetailLoading: false,
  isLoading: false,
  isLoadingMore: false,
  items: [
    {
      createdLabel: "Jul 31, 2026",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      id: "account:ada",
      onOpen: vi.fn(),
      storageLabel: "1 KiB of 10 KiB",
    },
  ],
  nextCursor: "next",
  onLoadMore: vi.fn(),
  onRetry: vi.fn(),
  onSearch: vi.fn(),
  search: "",
  searchInput: vi.fn(),
  selectedDomain: "example.com",
  status: "available",
  success: null,
  ...overrides,
});

const render = (props: AdminMailUsersViewProps): string =>
  renderToStaticMarkup(createElement(AdminMailUsersView, props));

describe("admin mailbox users view", () => {
  it("renders an accessible directory, pagination, and safe details", () => {
    const html = render(model());

    expect(html).toContain('aria-labelledby="mailbox-users-title"');
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Organization mailboxes"');
    expect(html).toContain("Load more");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("alias@example.com");
  });

  it("uses password-manager-safe fields and conditional admin OTP", () => {
    const html = render(model());

    expect(html.match(/type="password"/g)).toHaveLength(3);
    expect(html.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toContain("Passwords are sent once and never displayed later.");
  });

  it("disables creation when the provider owns accounts externally", () => {
    const html = render(
      model({
        create: {
          ...model().create,
          isAvailable: false,
          reason: "Accounts are owned by an external directory.",
        },
      }),
    );

    expect(html).toContain("Accounts are owned by an external directory.");
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });

  it("explains unconfigured capability without rendering secret fields", () => {
    const html = render(
      model({
        capabilityDescription: "Add the management credential on the server.",
        capabilityTitle: "Mailbox administration needs configuration",
        status: "unconfigured",
      }),
    );

    expect(html).toContain("Mailbox administration needs configuration");
    expect(html).toContain("Add the management credential on the server.");
    expect(html).not.toContain('type="password"');
    expect(html).toContain("Retry");
  });

  it("locks navigation and the form during one creation request", () => {
    const html = render(
      model({ create: { ...model().create, isSubmitting: true } }),
    );

    expect(html).toMatch(/<select[^>]*disabled/);
    expect(html).toMatch(/<input[^>]*disabled[^>]*type="search"/);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Creating mailbox…");
  });

  it("does not render stale users when no snapshot owns the selection", () => {
    const html = render(
      model({
        error: "Unable to load mailboxes.",
        selectedDomain: "new.example",
        status: null,
      }),
    );

    expect(html).toContain("Unable to load mailboxes.");
    expect(html).not.toContain("ada@example.com");
  });
});
