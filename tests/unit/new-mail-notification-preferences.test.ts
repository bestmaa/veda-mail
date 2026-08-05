import { describe, expect, it, vi } from "vitest";
import {
  defaultNotificationPreferences,
  readNotificationPreferences,
  writeNotificationPreferences,
} from "@/presentation/features/mail-workspace/new-mail-notification-preferences";

describe("new mail notification preferences", () => {
  it("defaults to private content and disabled browser notifications", () => {
    expect(readNotificationPreferences({ getItem: () => null }, "owner-a"))
      .toEqual(defaultNotificationPreferences("owner-a"));
  });

  it("rejects another account, extra fields and oversized values", () => {
    for (const stored of [
      JSON.stringify({ content: "details", owner: "owner-b", webEnabled: true }),
      JSON.stringify({ content: "details", extra: true, owner: "owner-a", webEnabled: true }),
      "x".repeat(2_049),
    ]) {
      expect(readNotificationPreferences({ getItem: () => stored }, "owner-a"))
        .toEqual(defaultNotificationPreferences("owner-a"));
    }
  });

  it("accepts only the bounded strict schema", () => {
    const stored = JSON.stringify({ content: "details", owner: "owner-a",
      webEnabled: true });
    expect(readNotificationPreferences({ getItem: () => stored }, "owner-a"))
      .toEqual({ content: "details", owner: "owner-a", webEnabled: true });
  });

  it("contains storage failures without breaking mail", () => {
    const setItem = vi.fn(() => { throw new Error("quota"); });
    expect(writeNotificationPreferences({ setItem },
      defaultNotificationPreferences("owner-a"))).toBe(false);
  });
});
