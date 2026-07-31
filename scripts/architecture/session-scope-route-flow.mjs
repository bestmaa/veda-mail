import ts from "typescript";

import {
  callableShadowsPrimitive,
  callableUsesUnsupportedSyntax,
} from "./session-scope-route-shadow.mjs";
import {
  alternativeValues,
  bindName,
  cloneState,
  emptyValue,
  markProtectedUse,
  mergeSecurityState,
} from "./session-scope-route-state.mjs";
import {
  evaluateAt,
  outcome,
  runStatements,
} from "./session-scope-route-statements.mjs";

const initialState = (bindings = new Map()) => ({
  authenticated: new Set(),
  bindings,
  guarded: new Set(),
  waived: new Set(),
});

const analyzeCallable = (
  callable,
  arguments_,
  base,
  context,
  depth,
  feedsReturn = false,
) => {
  if (!callable.body) {
    context.violation = true;
    return [outcome(cloneState(base))];
  }
  if (callableShadowsPrimitive(callable, context.imports)) {
    context.violation = true;
  }
  if (callableUsesUnsupportedSyntax(callable)) context.violation = true;
  const state = cloneState(base);
  callable.parameters.forEach((parameter, index) => {
    const provided = arguments_[index];
    const fallback = parameter.initializer
      ? evaluateAt(parameter.initializer, state, context, depth)
      : null;
    bindName(
      parameter.name,
      fallback && provided
        ? alternativeValues(provided, fallback)
        : fallback ?? provided ?? emptyValue(),
      state,
      (initializer) => evaluateAt(initializer, state, context, depth),
    );
  });
  const previousReturning = context.returning;
  if (ts.isBlock(callable.body)) {
    context.returnFrames.push(feedsReturn);
    context.returning = false;
    const results = runStatements(
      callable.body.statements,
      [outcome(state)],
      context,
      depth,
    );
    context.returnFrames.pop();
    context.returning = previousReturning;
    return results;
  }
  context.returning = feedsReturn;
  const value = evaluateAt(callable.body, state, context, depth);
  context.returning = previousReturning;
  return [outcome(state, "return", value)];
};

const successfulResults = (results) =>
  results.filter(({ kind }) => kind !== "throw");

const freshAuthentication = (state) =>
  [...state.authenticated].some(
    (token) => !state.guarded.has(token) && !state.waived.has(token),
  );

const returnedValue = (results) =>
  alternativeValues(
    ...results
      .filter(({ kind }) => kind === "return")
      .map(({ value }) => value),
  );

const callHelper = (helper, arguments_, caller, context) => {
  const key = helper.pos;
  if (context.callStack.has(key)) {
    context.violation = true;
    return emptyValue();
  }
  context.callStack.add(key);
  const feedsReturn = context.returning;
  const results = analyzeCallable(
    helper,
    arguments_,
    caller,
    context,
    context.depth + 1,
    feedsReturn,
  );
  context.callStack.delete(key);
  results
    .filter(({ kind }) => kind === "throw")
    .forEach(({ state }) => context.recordThrow(state));
  const completed = successfulResults(results);
  if (completed.length === 0) return emptyValue();
  mergeSecurityState(
    caller,
    completed.map(({ state }) => state),
  );
  return returnedValue(completed);
};

const inspectCallback = (value, caller, context) => {
  if (value.callables.length === 0) return { value: emptyValue() };
  if (value.callables.length !== 1) {
    context.violation = true;
    return { value: emptyValue() };
  }
  const helper = value.callables[0];
  if (context.callStack.has(helper.pos)) {
    context.violation = true;
    return { value: emptyValue() };
  }
  context.callStack.add(helper.pos);
  const sawBefore = context.sawAuthentication;
  const feedsReturn = context.returning;
  const results = analyzeCallable(
    helper,
    [],
    caller,
    context,
    context.depth + 1,
    feedsReturn,
  );
  context.sawAuthentication = sawBefore;
  context.callStack.delete(helper.pos);
  const completed = successfulResults(results);
  if (completed.some(({ state }) => freshAuthentication(state))) {
    context.violation = true;
  }
  return { value: returnedValue(completed) };
};

export const analyzeSessionScopeHandler = (handler, bindings, imports) => {
  const context = {
    bindings,
    callHelper: undefined,
    callStack: new Set(),
    depth: 0,
    imports,
    inspectCallback: undefined,
    moduleStack: new Set(),
    nextToken: 0,
    recordThrow: undefined,
    returnFrames: [],
    returning: false,
    sawAuthentication: false,
    securityEvents: 0,
    throwCollectors: [],
    violation: false,
  };
  context.callHelper = (helper, arguments_, caller) =>
    callHelper(helper, arguments_, caller, context);
  context.inspectCallback = (value, caller) =>
    inspectCallback(value, caller, context);
  context.recordThrow = (state) => {
    const collector = context.throwCollectors.at(-1);
    if (collector) collector.push(cloneState(state));
  };
  const request = {
    ...emptyValue(),
    requestCarrier: true,
    requestDerived: true,
    requestObject: true,
  };
  const arguments_ = handler.parameters.map((_, index) =>
    index === 0 ? request : emptyValue(),
  );
  const results = analyzeCallable(
    handler,
    arguments_,
    initialState(),
    context,
    0,
    true,
  );
  for (const result of successfulResults(results)) {
    markProtectedUse(result.value, result.state, context);
    if (result.value.untrustedResult) context.violation = true;
    if (freshAuthentication(result.state)) context.violation = true;
  }
  if (!context.sawAuthentication) context.violation = true;
  return { violation: context.violation };
};
