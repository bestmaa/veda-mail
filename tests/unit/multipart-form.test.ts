import { describe, expect, it } from "vitest";

import { readMultipartFormData } from "@/server/http/multipart-form";
import type { ApiError } from "@/transport/http/api-error";

const formRequest = (
  entries: ReadonlyArray<readonly [string, string]>,
): Request => {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return new Request("https://mail.example.com/api", {
    body: form,
    method: "POST",
  });
};

describe("multipart form body limits", () => {
  it("parses a valid multipart form without changing its fields", async () => {
    const parsed = await readMultipartFormData(
      formRequest([
        ["organizationName", "Veda Concepts"],
        ["primaryColor", "#27276f"],
      ]),
      4_096,
    );
    expect(parsed.get("organizationName")).toBe("Veda Concepts");
    expect(parsed.get("primaryColor")).toBe("#27276f");
  });

  it("rejects an oversized Content-Length before reading the stream", async () => {
    const request = new Request("https://mail.example.com/api", {
      body: new ReadableStream<Uint8Array>(),
      duplex: "half",
      headers: {
        "content-length": "4097",
        "content-type": "multipart/form-data; boundary=example",
      },
      method: "POST",
    } as RequestInit & { duplex: "half" });
    await expect(readMultipartFormData(request, 4_096)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
    expect(request.bodyUsed).toBe(false);
  });

  it("enforces the streamed byte count when Content-Length is absent", async () => {
    const request = formRequest([["payload", "x".repeat(1_024)]]);
    await expect(readMultipartFormData(request, 128)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it("does not trust an undersized Content-Length", async () => {
    const original = formRequest([["payload", "x".repeat(1_024)]]);
    const request = new Request(original, {
      headers: new Headers(original.headers),
    });
    request.headers.set("content-length", "1");
    await expect(readMultipartFormData(request, 128)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it("rejects non-multipart bodies", async () => {
    const request = new Request("https://mail.example.com/api", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await expect(readMultipartFormData(request)).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    } satisfies Partial<ApiError>);
  });
});
