import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "@playwright/test";
import { verifyProductionPwa } from "./verify-production-pwa.mjs";
import { verifyProductionObservability } from "./verify-production-observability.mjs";
const HSTS = "max-age=31536000";
const CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";
const RESIZE_HASH =
  "'sha256-5Y5olpdfb9HF2ncx6UGgnO2gTM7kh1s0vsUA1qpyKYQ='";
const STYLE_HASH =
  "'sha256-XlvOrZZXWg7NrvGw2jLpa7JEfoqVDyMDODOspEISjTI='";

const reservePort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
};

const waitForHealth = async (origin, server) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    assert.equal(server.exitCode, null, "Production server stopped early.");
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return response;
    } catch {
      // The standalone listener is still starting.
    }
    await delay(250);
  }
  throw new Error("Production server did not become healthy.");
};

const directiveSources = (policy, name) => {
  const directive = policy
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name} `));
  assert.ok(directive, `Missing ${name} directive.`);
  return directive.split(/\s+/u).slice(1);
};

const nonceFromPolicy = (policy) => {
  const nonce = /'nonce-([A-Za-z0-9_-]{22})'/u.exec(policy)?.[1];
  assert.ok(nonce, "Production CSP is missing a 128-bit nonce.");
  return nonce;
};

const assertDocumentHeaders = async (response) => {
  assert.equal(response.headers()["strict-transport-security"], HSTS);
  assert.equal(response.headers()["cache-control"], CACHE_CONTROL);
  assert.equal(
    response.headers()["referrer-policy"],
    "strict-origin-when-cross-origin",
  );
  assert.equal(response.headers()["x-nonce"], undefined);
  const policy = response.headers()["content-security-policy"];
  assert.ok(policy, "Production document is missing CSP.");
  assert.doesNotMatch(policy, /[\r\n]/u);
  const nonce = nonceFromPolicy(policy);
  const scripts = directiveSources(policy, "script-src");
  assert.ok(scripts.includes(`'nonce-${nonce}'`));
  assert.ok(scripts.includes("'strict-dynamic'"));
  assert.ok(scripts.includes(RESIZE_HASH));
  assert.ok(!scripts.includes("'unsafe-eval'"));
  assert.ok(!scripts.includes("'unsafe-inline'"));
  const styles = directiveSources(policy, "style-src");
  assert.ok(styles.includes(`'nonce-${nonce}'`));
  assert.ok(styles.includes(STYLE_HASH));
  assert.ok(!styles.includes("'unsafe-inline'"));
  assert.deepEqual(directiveSources(policy, "frame-src"), ["blob:"]);
  assert.deepEqual(directiveSources(policy, "child-src"), ["blob:"]);
  assert.deepEqual(directiveSources(policy, "img-src"), [
    "'self'",
    "data:",
    "blob:",
  ]);
  return { nonce, policy };
};

const assertServerScriptNonces = async (response, nonce) => {
  const tags = [...(await response.text()).matchAll(/<script\b[^>]*>/giu)].map(
    ([tag]) => tag,
  );
  assert.ok(tags.length > 0, "Production document has no framework scripts.");
  for (const tag of tags) assert.match(tag, new RegExp(`nonce="${nonce}"`, "u"));
};

const stopServer = async (server) => {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(5_000)]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
};

const root = process.cwd();
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "veda-mail-production-security-"),
);
const runtimeRoot = path.join(temporaryRoot, "runtime");
const dataRoot = path.join(temporaryRoot, "data");
let browser;
let server;
let serverOutput = "";

try {
  await cp(path.join(root, ".next", "standalone"), runtimeRoot, {
    recursive: true,
  });
  await cp(
    path.join(root, ".next", "static"),
    path.join(runtimeRoot, ".next", "static"),
    { recursive: true },
  );
  await cp(path.join(root, "public"), path.join(runtimeRoot, "public"), {
    recursive: true,
  });
  await mkdir(dataRoot);
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
      VEDA_MAIL_DATA_DIR: dataRoot,
      VEDA_MAIL_JOB_KEY: Buffer.alloc(32, 11).toString("base64"),
      VEDA_MAIL_PUBLIC_URL: origin,
      VEDA_MAIL_SETUP_TOKEN: "production-security-smoke-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverOutput = `${serverOutput}${String(chunk)}`.slice(-20_000);
    });
  }

  const health = await waitForHealth(origin, server);
  assert.equal(health.headers.get("strict-transport-security"), HSTS);
  assert.equal(health.headers.get("content-security-policy"), null);
  await verifyProductionObservability({ health, origin });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const violations = [];
    Object.defineProperty(window, "__vedaProductionCspViolations", {
      value: violations,
    });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.effectiveDirective}:${event.blockedURI}`);
    });
  });
  const first = await page.goto(origin, { waitUntil: "networkidle" });
  assert.ok(first, "Production navigation returned no response.");
  const firstHeaders = await assertDocumentHeaders(first);
  await assertServerScriptNonces(first, firstHeaders.nonce);
  assert.deepEqual(
    await page.evaluate(() => window.__vedaProductionCspViolations),
    [],
  );

  const second = await page.reload({ waitUntil: "networkidle" });
  assert.ok(second, "Production reload returned no response.");
  const secondHeaders = await assertDocumentHeaders(second);
  assert.notEqual(secondHeaders.nonce, firstHeaders.nonce);
  assert.deepEqual(
    await page.evaluate(() => window.__vedaProductionCspViolations),
    [],
  );
  await verifyProductionPwa({ origin, page });

  const attachment = await fetch(
    `${origin}/api/v1/mail/messages/fake/attachments/fake`,
    { headers: { origin } },
  );
  assert.equal(attachment.status, 401);
  assert.equal(attachment.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    attachment.headers.get("content-security-policy"),
    "sandbox; default-src 'none'",
  );
  assert.equal(attachment.headers.get("strict-transport-security"), HSTS);

  const inlineImage = await fetch(
    `${origin}/api/v1/mail/messages/fake/attachments/fake/inline-image`,
    {
      body: JSON.stringify({ renderer: "inline-image" }),
      headers: {
        "content-type": "application/json",
        origin,
      },
      method: "POST",
    },
  );
  assert.equal(inlineImage.status, 401);
  assert.equal(inlineImage.headers.get("referrer-policy"), "no-referrer");
  const inlinePolicy = inlineImage.headers.get("content-security-policy");
  assert.equal(
    inlinePolicy,
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
  );
  assert.doesNotMatch(inlinePolicy, /allow-same-origin/u);
  assert.equal(
    inlineImage.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.equal(
    inlineImage.headers.get("x-content-type-options"),
    "nosniff",
  );
  assert.equal(inlineImage.headers.get("strict-transport-security"), HSTS);
  console.log("Production security-header smoke passed.");
} catch (error) {
  if (serverOutput) console.error(serverOutput);
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
  const parent = path.resolve(path.dirname(temporaryRoot));
  assert.equal(parent, path.resolve(tmpdir()));
  assert.match(path.basename(temporaryRoot), /^veda-mail-production-security-/u);
  await rm(temporaryRoot, { force: true, recursive: true });
}
