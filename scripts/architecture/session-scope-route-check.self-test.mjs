import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures.mjs";
import { sessionScopeHandlerViolations } from "./session-scope-route-check.mjs";

export const verifySessionScopeRouteChecker = () => {
  for (const fixture of SESSION_SCOPE_ROUTE_FIXTURES) {
    assert.deepEqual(
      fixture.fileName
        ? sessionScopeHandlerViolations(fixture.fileName, fixture.source)
        : sessionScopeHandlerViolations("fixture-route.ts", fixture.source),
      fixture.expected,
      fixture.name,
    );
  }
};

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  verifySessionScopeRouteChecker();
  console.log(
    `Session-scope route checker passed ${SESSION_SCOPE_ROUTE_FIXTURES.length} self-fixtures.`,
  );
}
