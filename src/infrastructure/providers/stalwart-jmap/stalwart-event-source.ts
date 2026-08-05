import "server-only";

import { z } from "zod";

const MAX_EVENT_BYTES = 64 * 1024;
const accountChangesSchema = z.record(
  z.string().max(256),
  z.string().max(1_024),
).refine((value) => Object.keys(value).length <= 32);
const stateChangeSchema = z.object({
  changed: z.record(z.string().max(1_024), accountChangesSchema)
    .refine((value) => Object.keys(value).length <= 16),
}).passthrough();

const replaceTemplate = (value: string, name: string, replacement: string) =>
  value
    .replaceAll(`{${name}}`, encodeURIComponent(replacement))
    .replaceAll(`%7B${name}%7D`, encodeURIComponent(replacement))
    .replaceAll(`%7b${name}%7d`, encodeURIComponent(replacement));

export const jmapEventSourceUrl = (template: string): string => {
  let value = replaceTemplate(template, "types", "Email,Mailbox");
  value = replaceTemplate(value, "closeafter", "state");
  value = replaceTemplate(value, "ping", "30");
  return value;
};

const isStateEvent = (event: string): boolean => {
  const lines = event.split(/\r?\n/u);
  const type = lines.find((line) => line.startsWith("event:"))
    ?.slice("event:".length).trim();
  const data = lines.filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim()).join("\n");
  if (type !== "state" || !data || data.length > MAX_EVENT_BYTES) return false;
  try {
    return stateChangeSchema.safeParse(JSON.parse(data)).success;
  } catch {
    return false;
  }
};

export const readJmapStateEvent = async (
  body: ReadableStream<Uint8Array>,
): Promise<boolean> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return false;
      buffer += decoder.decode(next.value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > MAX_EVENT_BYTES) {
        throw new Error("The JMAP event exceeded the safe size limit.");
      }
      let boundary = buffer.search(/\r?\n\r?\n/u);
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/u)?.[0] ?? "\n\n";
        buffer = buffer.slice(boundary + separator.length);
        if (isStateEvent(event)) return true;
        boundary = buffer.search(/\r?\n\r?\n/u);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};
