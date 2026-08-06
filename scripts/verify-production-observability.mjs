import assert from "node:assert/strict";

export const verifyProductionObservability = async ({ health, origin }) => {
  assert.match(health.headers.get("x-request-id"), /^[A-Za-z0-9_-]{16,64}$/u);
  const correlatedHealth = await fetch(`${origin}/api/health`, {
    headers: { "x-request-id": "production_smoke_123456789" },
  });
  assert.equal(
    correlatedHealth.headers.get("x-request-id"),
    "production_smoke_123456789",
  );
  const metrics = await fetch(`${origin}/api/metrics`);
  assert.equal(metrics.status, 404);
  assert.equal(metrics.headers.get("cache-control"), "private, no-store");
  const readiness = await fetch(`${origin}/api/ready`);
  assert.equal(readiness.status, 503);
  assert.equal(readiness.headers.get("cache-control"), "private, no-store");
};
