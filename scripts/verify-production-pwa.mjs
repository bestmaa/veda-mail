import assert from "node:assert/strict";

const OFFLINE_PATHS = [
  "/icons/veda-mail-192.png",
  "/icons/veda-mail-512.png",
  "/offline.css",
  "/offline.html",
];

const cacheSnapshot = async () => {
  const names = (await caches.keys())
    .filter((name) => name.startsWith("veda-mail-offline-"));
  const paths = [];
  for (const name of names) {
    const cache = await caches.open(name);
    paths.push(...(await cache.keys()).map((request) =>
      new URL(request.url).pathname));
  }
  return { names, paths: paths.sort() };
};

export const verifyProductionPwa = async ({ origin, page }) => {
  const manifestLink = page.locator('link[rel="manifest"]');
  assert.equal(await manifestLink.getAttribute("href"), "/manifest.webmanifest");

  const manifestResponse = await page.request.get(
    `${origin}/manifest.webmanifest`,
  );
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/");
  assert.deepEqual(
    manifest.icons.map(({ purpose, sizes }) => ({ purpose, sizes })),
    [
      { purpose: "any", sizes: "192x192" },
      { purpose: "any", sizes: "512x512" },
      { purpose: "maskable", sizes: "512x512" },
    ],
  );

  const workerResponse = await page.request.get(`${origin}/sw.js`);
  assert.equal(workerResponse.status(), 200);
  assert.equal(
    workerResponse.headers()["cache-control"],
    "no-cache, no-store, must-revalidate",
  );
  assert.equal(workerResponse.headers()["service-worker-allowed"], "/");

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.active?.scriptURL.endsWith("/sw.js") === true;
  });
  assert.deepEqual(await page.evaluate(cacheSnapshot), {
    names: ["veda-mail-offline-v1"],
    paths: OFFLINE_PATHS,
  });

  await page.context().setOffline(true);
  try {
    const offline = await page.goto(`${origin}/offline-proof`, {
      waitUntil: "domcontentloaded",
    });
    assert.ok(offline, "Offline navigation returned no service-worker response.");
    assert.equal(await page.locator("h1").textContent(), "You are offline");
    const content = await page.locator("body").textContent();
    assert.match(
      content,
      /No messages or account details are stored on this device/u,
    );
  } finally {
    await page.context().setOffline(false);
  }
};
