import assert from "node:assert/strict";

import { sharedDurableStateViolations } from
  "./shared-durable-state-check.mjs";

const unknown = sharedDurableStateViolations(new Map([
  ["src/server/new/file.ts", "process.env['VEDA_MAIL_DATA_DIR']"],
]), { enforceManifest: false });
assert.match(unknown[0], /explicit shared-state policy/u);

const localOnly = sharedDurableStateViolations(new Map([
  ["src/server/installation/setup-lock.ts", "VEDA_MAIL_DATA_DIR"],
]), { enforceManifest: false });
assert.deepEqual(localOnly, []);
