import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const MAX_SPECS_PER_SERVER = 5;
const root = process.cwd();
const testDirectory = path.join(root, "tests", "e2e");
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

const specFiles = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
  .map((entry) => path.posix.join("tests", "e2e", entry.name))
  .sort();

if (specFiles.length === 0) {
  throw new Error("No Playwright E2E specifications were found.");
}

const batches = [];
for (let index = 0; index < specFiles.length; index += MAX_SPECS_PER_SERVER) {
  batches.push(specFiles.slice(index, index + MAX_SPECS_PER_SERVER));
}

const runBatch = (files, index) =>
  new Promise((resolve, reject) => {
    console.log(
      `Running Playwright batch ${index + 1}/${batches.length}: ${files.join(", ")}`,
    );
    const child = spawn(process.execPath, [playwrightCli, "test", ...files], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `Playwright batch ${index + 1} stopped with ${signal}.`
            : `Playwright batch ${index + 1} failed with exit code ${code}.`,
        ),
      );
    });
  });

for (const [index, batch] of batches.entries()) {
  await runBatch(batch, index);
}
