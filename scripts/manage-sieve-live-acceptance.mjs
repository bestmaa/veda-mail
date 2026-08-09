#!/usr/bin/env node

import { runManageSieveAcceptance } from "./manage-sieve-live/run.mjs";

try {
  const result = await runManageSieveAcceptance();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : "ManageSieve acceptance failed.");
  process.exitCode = 1;
}
