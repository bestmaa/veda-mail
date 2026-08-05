import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;
const listeners = new Map<string, Listener>();
const addAll = vi.fn();
const cacheMatch = vi.fn();
const deleteCache = vi.fn();
const claim = vi.fn();
const skipWaiting = vi.fn();
const caches = {
  delete: deleteCache,
  keys: vi.fn(async () => ["unrelated", "veda-mail-offline-old", "veda-mail-offline-v1"]),
  match: cacheMatch,
  open: vi.fn(async () => ({ addAll, match: cacheMatch })),
};
const worker = {
  addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
  clients: { claim },
  location: { origin: "https://mail.example" },
  skipWaiting,
};

const runEvent = async (name: string, event: Record<string, unknown> = {}) => {
  let pending: Promise<unknown> | null = null;
  listeners.get(name)?.({ ...event, waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
};

beforeEach(async () => {
  listeners.clear();
  vi.clearAllMocks();
  const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { caches, fetch: vi.fn(), Response, self: worker, URL });
});

describe("service worker cache boundary", () => {
  it("precaches only the four fixed public offline assets", async () => {
    await runEvent("install");
    expect(addAll).toHaveBeenCalledWith([
      "/offline.html", "/offline.css", "/icons/veda-mail-192.png",
      "/icons/veda-mail-512.png",
    ]);
    expect(skipWaiting).toHaveBeenCalledOnce();
  });

  it("removes only stale Veda offline caches", async () => {
    await runEvent("activate");
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("veda-mail-offline-old");
    expect(claim).toHaveBeenCalledOnce();
  });

  it("never intercepts authenticated API traffic", () => {
    const respondWith = vi.fn();
    listeners.get("fetch")?.({ request: { method: "GET", mode: "cors",
      url: "https://mail.example/api/v1/mail/workspace" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
  });

  it("uses the generic cached document only after navigation network failure", async () => {
    const offline = new Response("offline");
    cacheMatch.mockResolvedValue(offline);
    const network = vi.fn(async () => { throw new TypeError("offline"); });
    vm.runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"),
      { caches, fetch: network, Response, self: worker, URL });
    let response: Promise<Response> | null = null;
    listeners.get("fetch")?.({ request: { method: "GET", mode: "navigate",
      url: "https://mail.example/inbox" }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await response).toBe(offline);
    expect(network).toHaveBeenCalledOnce();
    expect(cacheMatch).toHaveBeenCalledWith("/offline.html");
  });
});
