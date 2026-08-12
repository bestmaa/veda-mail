import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  decryptSharedSession,
  encryptSharedSession,
  sharedSessionOpaqueId,
  sharedSessionOwnerIndex,
} from "@/server/shared-state/shared-session-crypto";

const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
const schema = z.object({ secret: z.string(), version: z.literal(1) }).strict();

beforeEach(() => {
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 29).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
});

describe("shared session authenticated encryption", () => {
  it("round trips without exposing the id or plaintext", () => {
    const id = "raw-bearer-session-id";
    const opaque = sharedSessionOpaqueId("member", id);
    const encrypted = encryptSharedSession("member", opaque, {
      secret: "provider-password", version: 1,
    });
    expect(opaque).not.toContain(id);
    expect(encrypted).not.toContain("provider-password");
    expect(decryptSharedSession("member", opaque, encrypted, schema)).toEqual({
      secret: "provider-password", version: 1,
    });
  });

  it("binds ciphertext to the session kind and opaque record key", () => {
    const opaque = sharedSessionOpaqueId("member", "member-session");
    const encrypted = encryptSharedSession("member", opaque, {
      secret: "provider-password", version: 1,
    });
    expect(() => decryptSharedSession(
      "administrator", opaque, encrypted, schema,
    )).toThrow();
    expect(() => decryptSharedSession(
      "member", sharedSessionOpaqueId("member", "other"), encrypted, schema,
    )).toThrow();
  });

  it("derives stable distinct record and owner indexes", () => {
    expect(sharedSessionOpaqueId("member", "same"))
      .toBe(sharedSessionOpaqueId("member", "same"));
    expect(sharedSessionOpaqueId("member", "same"))
      .not.toBe(sharedSessionOpaqueId("administrator", "same"));
    expect(sharedSessionOwnerIndex("same"))
      .not.toBe(sharedSessionOpaqueId("member", "same"));
  });
});
