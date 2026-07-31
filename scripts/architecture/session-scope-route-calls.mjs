import ts from "typescript";

import { unwrapExpression } from "./session-scope-route-ast.mjs";
import {
  alternativeValues,
  cloneState,
  combineValues,
  emptyValue,
  markProtectedUse,
} from "./session-scope-route-state.mjs";

const callArguments = (node, state, context, evaluateExpression) =>
  node.arguments.map((argument) =>
    evaluateExpression(argument, state, context),
  );

const evaluateGuard = (kind, arguments_, state, context) => {
  const supplied = arguments_[0] ?? emptyValue();
  const connection = arguments_[1] ?? emptyValue();
  const validScope =
    kind === "request-guard"
      ? supplied.requestObject
      : supplied.requestDerived;
  if (
    !validScope ||
    connection.connections.size !== 1 ||
    connection.exactConnections.size !== 1 ||
    connection.fields instanceof Map
  ) {
    context.violation = true;
    return emptyValue();
  }
  const [token] = connection.connections;
  if (
    !token ||
    !connection.exactConnections.has(token) ||
    !state.authenticated.has(token)
  ) {
    context.violation = true;
    return emptyValue();
  }
  context.recordThrow(state);
  state.guarded.add(token);
  context.securityEvents += 1;
  return emptyValue();
};

const evaluatePrimitive = (kind, arguments_, state, context, node) => {
  if (kind === "connection") {
    if (arguments_.some((value) => value.callables.length > 0)) {
      context.violation = true;
    }
    context.recordThrow(state);
    const token = `connection:${node.pos}:${context.nextToken++}`;
    state.authenticated.add(token);
    context.sawAuthentication = true;
    context.securityEvents += 1;
    return {
      ...emptyValue(),
      connections: new Set([token]),
      exactConnections: new Set([token]),
    };
  }
  if (kind === "auth-wrapper") {
    const connection = arguments_[0] ?? emptyValue();
    const [token] = connection.connections;
    if (
      connection.connections.size !== 1 ||
      !token ||
      !state.authenticated.has(token) ||
      !state.guarded.has(token)
    ) {
      context.violation = true;
      return emptyValue();
    }
    context.recordThrow(state);
    return connection;
  }
  if (kind === "request-utility") {
    inspectCallbacks(arguments_, state, context);
    const result = combineValues(...arguments_);
    result.requestCarrier = false;
    result.requestFactory = false;
    result.requestObject = false;
    context.recordThrow(state);
    markProtectedUse(result, state, context);
    return result;
  }
  return evaluateGuard(kind, arguments_, state, context);
};

const inspectCallbacks = (values, state, context) =>
  values.map((value) => context.inspectCallback(value, state));

const evaluateCatch = (node, receiverNode, state, context, evaluateExpression) => {
  const existing = new Set(state.authenticated);
  const receiver = evaluateExpression(receiverNode, state, context);
  const arguments_ = callArguments(node, state, context, evaluateExpression);
  const fallbackState = cloneState(state);
  for (const token of receiver.connections) {
    if (existing.has(token)) continue;
    fallbackState.authenticated.delete(token);
    fallbackState.guarded.delete(token);
    fallbackState.waived.delete(token);
  }
  const fallbacks = inspectCallbacks(arguments_, fallbackState, context);
  if (arguments_.length === 0 || arguments_[0].callables.length === 0) {
    context.violation = true;
  }
  const result = alternativeValues(
    receiver,
    ...fallbacks.map(({ value }) => value),
  );
  receiver.connections.forEach((token) =>
    result.nullableConnections.add(token),
  );
  return result;
};

const evaluateCallable = (callee, arguments_, state, context) => {
  if (callee.callables.length !== 1 || callee.primitives.size > 0) {
    context.violation = true;
    return emptyValue();
  }
  return context.callHelper(callee.callables[0], arguments_, state);
};

const evaluateUnknown = (callee, arguments_, state, context) => {
  const callbacks = inspectCallbacks(arguments_, state, context);
  const callbackValues = callbacks.map(({ value }) => value);
  const untrusted = callee.importedCallable || callee.untrustedResult;
  if (untrusted) context.violation = true;
  if (
    context.returning &&
    arguments_.some((value) => value.requestObject)
  ) {
    context.violation = true;
  }
  if (
    callee.primitives.size > 0 ||
    arguments_.some((value) => value.primitives.size > 0)
  ) {
    context.violation = true;
  }
  const result = combineValues(callee, ...arguments_, ...callbackValues);
  result.callables = [];
  result.importedCallable = false;
  result.primitives.clear();
  if (callee.requestFactory) {
    result.requestCarrier = true;
    result.requestDerived = true;
    result.requestObject = true;
  } else if (untrusted) {
    result.requestCarrier = false;
    result.requestDerived = false;
    result.requestFactory = false;
    result.requestObject = false;
    result.untrustedResult ||=
      arguments_.length === 0 ||
      arguments_.some((value) => value.requestDerived);
  }
  if (context.returning && result.untrustedResult) {
    context.violation = true;
  }
  context.recordThrow(state);
  markProtectedUse(result, state, context);
  return result;
};

export const evaluateRouteCall = (
  node,
  state,
  context,
  evaluateExpression,
) => {
  const target = unwrapExpression(node.expression);
  if (target.kind === ts.SyntaxKind.ImportKeyword) {
    node.arguments.forEach((argument) =>
      evaluateExpression(argument, state, context),
    );
    context.violation = true;
    return emptyValue();
  }
  if (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "catch"
  ) {
    return evaluateCatch(
      node,
      target.expression,
      state,
      context,
      evaluateExpression,
    );
  }
  const callee = evaluateExpression(node.expression, state, context);
  const arguments_ = callArguments(node, state, context, evaluateExpression);
  if (callee.primitives.size > 0) {
    if (callee.primitives.size !== 1 || callee.callables.length > 0) {
      context.violation = true;
      return emptyValue();
    }
    return evaluatePrimitive(
      [...callee.primitives][0],
      arguments_,
      state,
      context,
      node,
    );
  }
  if (callee.callables.length > 0) {
    return evaluateCallable(callee, arguments_, state, context);
  }
  return evaluateUnknown(callee, arguments_, state, context);
};
