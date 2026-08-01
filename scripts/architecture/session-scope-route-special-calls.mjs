import { emptyValue } from "./session-scope-route-state.mjs";

const evaluateTicketGuard = (arguments_, state, context) => {
  const binding = arguments_[0] ?? emptyValue();
  const connection = binding.fields?.get("connectionId") ?? emptyValue();
  const message = binding.fields?.get("messageId");
  const ticket = binding.fields?.get("ticket") ?? emptyValue();
  const [token] = connection.connections;
  if (
    !context.allowTicketGuard ||
    arguments_.length !== 1 ||
    !(binding.fields instanceof Map) ||
    connection.connections.size !== 1 ||
    !token ||
    !state.authenticated.has(token) ||
    !message ||
    !ticket.requestDerived
  ) {
    context.violation = true;
    return emptyValue();
  }
  context.recordThrow(state);
  state.guarded.add(token);
  context.securityEvents += 1;
  return emptyValue();
};

const evaluateSubjectRate = (arguments_, state, context) => {
  const subject = arguments_[1] ?? emptyValue();
  const [token] = subject.connections;
  context.violation ||=
    subject.connections.size !== 1 ||
    !token ||
    !state.authenticated.has(token);
  context.recordThrow(state);
  return emptyValue();
};

const evaluateArchiveLease = (arguments_, state, context) => {
  const subject = arguments_[0] ?? emptyValue();
  const [token] = subject.connections;
  context.violation ||=
    subject.connections.size !== 1 ||
    !token ||
    !state.authenticated.has(token) ||
    (!state.guarded.has(token) && !context.allowTicketGuard);
  context.recordThrow(state);
  return emptyValue();
};

export const evaluateSpecialPrimitive = (kind, arguments_, state, context) => {
  if (kind === "archive-lease") {
    return evaluateArchiveLease(arguments_, state, context);
  }
  if (kind === "subject-rate") {
    return evaluateSubjectRate(arguments_, state, context);
  }
  if (kind === "ticket-guard") {
    return evaluateTicketGuard(arguments_, state, context);
  }
  return null;
};
