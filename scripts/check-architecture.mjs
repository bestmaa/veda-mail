import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("src");

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
};

const rules = [
  {
    applies: (file) => file.includes(`${path.sep}ui${path.sep}`),
    message: "UI files cannot own React state or effects",
    pattern:
      /\b(useState|useEffect|useReducer|useMemo|useCallback|useRef|useSyncExternalStore)\b/,
  },
  {
    applies: (file) => file.includes(`${path.sep}ui${path.sep}`),
    message: "UI files cannot fetch data",
    pattern: /\bfetch\s*\(/,
  },
  {
    applies: (file) => file.includes(`${path.sep}ui${path.sep}`),
    message: "UI files cannot import hooks or infrastructure",
    pattern:
      /from\s+["']@\/(?:application|infrastructure|server|transport|presentation\/.*\/hooks)\//,
  },
  {
    applies: (file) => file.includes(`${path.sep}domain${path.sep}`),
    message: "Domain files cannot import outer layers",
    pattern:
      /from\s+["']@\/(?:application|app|bootstrap|infrastructure|presentation|server|transport)\//,
  },
  {
    applies: (file) => file.includes(`${path.sep}application${path.sep}`),
    message: "Application files cannot import outer adapters",
    pattern:
      /from\s+["']@\/(?:app|bootstrap|infrastructure|presentation|server|transport)\//,
  },
  {
    applies: (file) =>
      file.includes(`${path.sep}infrastructure${path.sep}providers${path.sep}`) &&
      !file.endsWith(".types.ts") &&
      !file.endsWith("mock-seed.ts"),
    message: "Provider implementation files must be server-only",
    pattern: /^(?!import ["']server-only["'];)/s,
  },
];

const files = await collectFiles(sourceRoot);
const violations = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const rule of rules) {
    if (rule.applies(file) && rule.pattern.test(content)) {
      violations.push(
        `${path.relative(process.cwd(), file)} — ${rule.message}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture checks passed across ${files.length} source files.`);
}
