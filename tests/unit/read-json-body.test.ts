import { describe, expect, it } from "vitest";

import {
  MAX_JSON_BODY_BYTES,
  readJsonBody,
} from "@/transport/http/read-json-body";
import type { ApiError } from "@/transport/http/api-error";

const jsonRequest = (
  body: BodyInit | null,
  headers: HeadersInit = { "content-type": "application/json" },
): Request =>
  new Request("https://mail.example.com/api", {
    body,
    headers,
    method: "POST",
  });

describe("readJsonBody", () => {
  it("parses a valid application/json request", async () => {
    await expect(
      readJsonBody(jsonRequest(JSON.stringify({ message: "hello" }))),
    ).resolves.toEqual({ message: "hello" });
  });

  it("allows a charset parameter and case-insensitive media type", async () => {
    const request = jsonRequest("true", {
      "content-type": "Application/JSON; charset=utf-8",
    });
    await expect(readJsonBody(request)).resolves.toBe(true);
  });

  it.each([undefined, "text/plain", "application/problem+json"])(
    "rejects a missing or wrong media type: %s",
    async (contentType) => {
      const headers = contentType ? { "content-type": contentType } : {};
      await expect(readJsonBody(jsonRequest("{}", headers))).rejects.toMatchObject(
        {
          code: "UNSUPPORTED_MEDIA_TYPE",
          status: 415,
        } satisfies Partial<ApiError>,
      );
    },
  );

  it("rejects an oversized Content-Length before reading the stream", async () => {
    const request = new Request("https://mail.example.com/api", {
      body: new ReadableStream<Uint8Array>(),
      duplex: "half",
      headers: {
        "content-length": "65",
        "content-type": "application/json",
      },
      method: "POST",
    } as RequestInit & { duplex: "half" });

    await expect(readJsonBody(request, 64)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a malformed Content-Length", async () => {
    const request = jsonRequest("{}", {
      "content-length": "not-a-number",
      "content-type": "application/json",
    });
    await expect(readJsonBody(request)).rejects.toMatchObject({
      code: "INVALID_CONTENT_LENGTH",
      status: 400,
    } satisfies Partial<ApiError>);
    expect(request.bodyUsed).toBe(false);
  });

  it("enforces the streamed byte count when Content-Length is absent", async () => {
    await expect(
      readJsonBody(jsonRequest(JSON.stringify({ value: "x".repeat(64) })), 32),
    ).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it("does not trust an undersized Content-Length", async () => {
    const request = jsonRequest(JSON.stringify({ value: "x".repeat(64) }), {
      "content-length": "1",
      "content-type": "application/json",
    });
    await expect(readJsonBody(request, 32)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it("measures UTF-8 bytes instead of JavaScript characters", async () => {
    await expect(readJsonBody(jsonRequest('"é"'), 3)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it.each(["", "   ", "{broken"])(
    "rejects empty or malformed JSON: %j",
    async (body) => {
      await expect(readJsonBody(jsonRequest(body))).rejects.toMatchObject({
        code: "INVALID_JSON",
        status: 400,
      } satisfies Partial<ApiError>);
    },
  );

  it("rejects malformed UTF-8", async () => {
    await expect(
      readJsonBody(jsonRequest(new Uint8Array([0xff]))),
    ).rejects.toMatchObject({
      code: "INVALID_JSON",
      status: 400,
    } satisfies Partial<ApiError>);
  });

  it("rejects an absent body", async () => {
    await expect(readJsonBody(jsonRequest(null))).rejects.toMatchObject({
      code: "INVALID_JSON",
      status: 400,
    } satisfies Partial<ApiError>);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid configured maximum: %s",
    async (maximumBytes) => {
      await expect(
        readJsonBody(jsonRequest("{}"), maximumBytes),
      ).rejects.toThrow(RangeError);
    },
  );

  it("exports a positive safe default maximum", () => {
    expect(Number.isSafeInteger(MAX_JSON_BODY_BYTES)).toBe(true);
    expect(MAX_JSON_BODY_BYTES).toBeGreaterThan(0);
  });
});
