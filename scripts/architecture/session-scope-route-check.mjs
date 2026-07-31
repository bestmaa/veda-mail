import ts from "typescript";

import {
  callableBindings,
  importBindings,
} from "./session-scope-route-ast.mjs";
import { exportedHandlers } from "./session-scope-route-exports.mjs";
import { analyzeSessionScopeHandler } from "./session-scope-route-flow.mjs";

export const sessionScopeHandlerViolations = (
  fileName,
  source,
  allowedUnscopedHandlers = new Set(),
) => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = importBindings(sourceFile);
  const bindings = callableBindings(sourceFile);
  const violations = [];
  for (const [method, record] of exportedHandlers(sourceFile, bindings)) {
    if (allowedUnscopedHandlers.has(method)) continue;
    if (record.unresolved || !record.handler) {
      violations.push(method);
      continue;
    }
    const security = analyzeSessionScopeHandler(
      record.handler,
      bindings,
      imports,
    );
    if (security.violation) violations.push(method);
  }
  return [...new Set(violations)].sort();
};
