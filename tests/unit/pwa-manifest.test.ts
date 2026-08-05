import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/installation/installation.store", () => ({
  installationStore: { getBranding: vi.fn(async () => ({
    accentColor: "#ff7357", organizationName: "Example Org",
    primaryColor: "#0b1238", productName: "Example Private Mail",
  })) },
}));
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("is standalone, root-scoped and contains install-sized any/maskable icons", async () => {
    const value = await manifest();
    expect(value).toMatchObject({ display: "standalone", id: "/", scope: "/",
      start_url: "/", name: "Example Private Mail" });
    expect(value.description).not.toContain("mailbox");
    expect(value.icons).toEqual([
      expect.objectContaining({ purpose: "any", sizes: "192x192" }),
      expect.objectContaining({ purpose: "any", sizes: "512x512" }),
      expect.objectContaining({ purpose: "maskable", sizes: "512x512" }),
    ]);
  });
});
