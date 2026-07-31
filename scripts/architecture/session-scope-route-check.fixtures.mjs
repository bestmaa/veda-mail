import { ADVERSARIAL_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-adversarial.mjs";
import { CORE_SESSION_SCOPE_ROUTE_FIXTURES } from "./session-scope-route-check.fixtures-core.mjs";

export const SESSION_SCOPE_ROUTE_FIXTURES = [
  ...CORE_SESSION_SCOPE_ROUTE_FIXTURES,
  ...ADVERSARIAL_SESSION_SCOPE_ROUTE_FIXTURES,
];
