import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_LINES = 250;
const ROOTS = ["src", "tests", "scripts"];
const EXTENSIONS = new Set([".css", ".js", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".next", "coverage", "node_modules"]);

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute)));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
};

const existingRoots = [];
for (const root of ROOTS) {
  try {
    existingRoots.push(...(await collectFiles(path.resolve(root))));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const violations = [];
for (const file of existingRoots) {
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/).length;
  if (lines > MAX_LINES) {
    violations.push(`${path.relative(process.cwd(), file)}: ${lines} lines`);
  }
}

if (violations.length > 0) {
  console.error(`Source files must not exceed ${MAX_LINES} lines:`);
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Line limit passed: ${existingRoots.length} source files are ≤ ${MAX_LINES} lines.`,
  );
}
