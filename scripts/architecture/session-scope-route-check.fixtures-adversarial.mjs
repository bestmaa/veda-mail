import { CONTROL_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-control.mjs";
import { ESCAPE_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-escapes.mjs";
import { EFFECT_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-effects.mjs";
import { RESOLUTION_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-resolution.mjs";
import { SYNTAX_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-syntax.mjs";

export const ADVERSARIAL_SESSION_SCOPE_ROUTE_FIXTURES = [
  ...CONTROL_SESSION_SCOPE_ROUTE_FIXTURES,
  ...EFFECT_SESSION_SCOPE_ROUTE_FIXTURES,
  ...ESCAPE_SESSION_SCOPE_ROUTE_FIXTURES,
  ...RESOLUTION_SESSION_SCOPE_ROUTE_FIXTURES,
  ...SYNTAX_SESSION_SCOPE_ROUTE_FIXTURES,
];
