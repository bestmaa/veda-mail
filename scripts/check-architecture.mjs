import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { adminRouteHandlerViolations } from "./architecture/admin-route-check.mjs";
import { unawaitedRateLimitCalls } from
  "./architecture/async-rate-limit-check.mjs";
import "./architecture/async-rate-limit-check.test.mjs";
import { verifyAdminRouteChecker } from "./architecture/admin-route-check.self-test.mjs";
import { verifySessionScopeRouteChecker } from "./architecture/session-scope-route-check.self-test.mjs";
import { sessionScopeHandlerViolations } from "./architecture/session-scope-route-check.mjs";
import { sharedDurableStateViolations } from
  "./architecture/shared-durable-state-check.mjs";
import "./architecture/shared-durable-state-check.test.mjs";

const sourceRoot = path.resolve("src");
const routeSuffix = `${path.sep}route.ts`;
const scopedRouteRoots = [
  `${path.sep}app${path.sep}api${path.sep}v1${path.sep}mail${path.sep}`,
  `${path.sep}app${path.sep}api${path.sep}v1${path.sep}member${path.sep}`,
];
const adminRouteRoot =
  `${path.sep}app${path.sep}api${path.sep}v1${path.sep}admin${path.sep}`;
const unauthenticatedAdminHandlers = new Map([
  [
    "src/app/api/v1/admin/auth/route.ts",
    new Set(["DELETE", "GET", "POST"]),
  ],
]);
const unscopedBootstrapHandlers = new Map([
  ["src/app/api/v1/mail/workspace/route.ts", new Set(["GET"])],
  ["src/app/api/v1/member/session/route.ts", new Set(["GET", "POST"])],
  [
    "src/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/inline-image/route.ts",
    new Set(["GET", "HEAD"]),
  ],
  [
    "src/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/preview/route.ts",
    new Set(["GET", "HEAD"]),
  ],
]);

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

verifyAdminRouteChecker();
verifySessionScopeRouteChecker();
const files = await collectFiles(sourceRoot);
const violations = [];
const sourceContents = new Map();
for (const file of files) {
  const content = await readFile(file, "utf8");
  const relative = path.relative(process.cwd(), file);
  const portableRelative = relative.split(path.sep).join("/");
  sourceContents.set(portableRelative, content);
  for (const line of unawaitedRateLimitCalls(relative, content)) {
    violations.push(
      `${relative}:${line} — Distributed rate-limit calls must be awaited`,
    );
  }
  for (const rule of rules) {
    if (rule.applies(file) && rule.pattern.test(content)) {
      violations.push(`${relative} — ${rule.message}`);
    }
  }
  if (
    file.endsWith(routeSuffix) &&
    scopedRouteRoots.some((root) => file.includes(root))
  ) {
    const allowed =
      unscopedBootstrapHandlers.get(portableRelative) ?? new Set();
    for (const handler of sessionScopeHandlerViolations(
      relative,
      content,
      allowed,
    )) {
      violations.push(
        `${relative}#${handler} — Authenticated route handler must enforce the browser session scope`,
      );
    }
  }
  if (file.endsWith(routeSuffix) && file.includes(adminRouteRoot)) {
    const allowed =
      unauthenticatedAdminHandlers.get(portableRelative) ?? new Set();
    for (const violation of adminRouteHandlerViolations(
      relative,
      content,
      allowed,
    )) {
      const [handler, requirement] = violation.split(":");
      violations.push(
        `${relative}#${handler} — Admin route is missing ${
          requirement === "same-origin"
            ? "same-origin mutation protection"
            : requirement === "admin-access"
              ? "administrator access enforcement"
              : "a statically analyzable handler"
        }`,
      );
    }
  }
}
violations.push(...sharedDurableStateViolations(sourceContents));

if (violations.length > 0) {
  console.error("Architecture boundary violations:");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture checks passed across ${files.length} source files.`);
}
