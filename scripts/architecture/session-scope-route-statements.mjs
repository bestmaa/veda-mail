import ts from "typescript";

import {
  runLoopControl,
  runTryControl,
} from "./session-scope-route-control.mjs";
import {
  bindName,
  callableValue,
  cloneState,
  emptyValue,
} from "./session-scope-route-state.mjs";
import {
  expressionStaticTruth,
  narrowOptionalConnection,
} from "./session-scope-route-narrow.mjs";
import { evaluateExpression } from "./session-scope-route-values.mjs";

export const outcome = (
  state,
  kind = "normal",
  value = emptyValue(),
) => ({ kind, state, value });

export const evaluateAt = (node, state, context, depth) => {
  const previousDepth = context.depth;
  context.depth = depth;
  const value = evaluateExpression(node, state, context);
  context.depth = previousDepth;
  return value;
};

const hoistFunctions = (statements, outcomes) => {
  for (const current of outcomes) {
    if (current.kind !== "normal") continue;
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        bindName(statement.name, callableValue(statement), current.state);
      }
    }
  }
};

export const runStatements = (
  statements,
  initial,
  context,
  depth,
) => {
  let outcomes = initial;
  hoistFunctions(statements, outcomes);
  for (const statement of statements) {
    const next = [];
    for (const current of outcomes) {
      if (current.kind === "normal") {
        next.push(...runStatement(statement, current.state, context, depth));
      } else {
        next.push(current);
      }
    }
    outcomes = next;
  }
  return outcomes;
};

const runVariableStatement = (statement, state, context, depth) => {
  for (const declaration of statement.declarationList.declarations) {
    const value = declaration.initializer
      ? evaluateAt(declaration.initializer, state, context, depth)
      : emptyValue();
    bindName(
      declaration.name,
      value,
      state,
      (initializer) => evaluateAt(initializer, state, context, depth),
    );
  }
  return [outcome(state)];
};

const runIfStatement = (statement, state, context, depth) => {
  const truth = expressionStaticTruth(statement.expression);
  evaluateAt(statement.expression, state, context, depth);
  const outcomes = [];
  if (truth !== false) {
    const whenTrue = cloneState(state);
    narrowOptionalConnection(statement.expression, whenTrue, true);
    outcomes.push(
      ...runStatement(statement.thenStatement, whenTrue, context, depth),
    );
  }
  if (truth !== true) {
    const whenFalse = cloneState(state);
    narrowOptionalConnection(statement.expression, whenFalse, false);
    outcomes.push(
      ...(statement.elseStatement
        ? runStatement(statement.elseStatement, whenFalse, context, depth)
        : [outcome(whenFalse)]),
    );
  }
  return outcomes;
};

export const runStatement = (statement, state, context, depth) => {
  if (ts.isBlock(statement)) {
    return runStatements(statement.statements, [outcome(state)], context, depth);
  }
  if (ts.isVariableStatement(statement)) {
    return runVariableStatement(statement, state, context, depth);
  }
  if (ts.isExpressionStatement(statement)) {
    evaluateAt(statement.expression, state, context, depth);
    return [outcome(state)];
  }
  if (ts.isReturnStatement(statement)) {
    const previousReturning = context.returning;
    context.returning = Boolean(context.returnFrames.at(-1));
    const value = evaluateAt(statement.expression, state, context, depth);
    context.returning = previousReturning;
    return [outcome(state, "return", value)];
  }
  if (ts.isThrowStatement(statement)) {
    return [outcome(
      state,
      "throw",
      evaluateAt(statement.expression, state, context, depth),
    )];
  }
  if (ts.isIfStatement(statement)) {
    return runIfStatement(statement, state, context, depth);
  }
  if (ts.isTryStatement(statement)) {
    return runTryControl(
      statement,
      state,
      context,
      depth,
      runStatements,
      outcome,
      evaluateAt,
    );
  }
  if (
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement)
  ) {
    return runLoopControl(statement, state, context, depth, {
      evaluateAt,
      outcome,
      runStatement,
      runVariableStatement,
    });
  }
  if (ts.isBreakStatement(statement)) return [outcome(state, "break")];
  if (ts.isContinueStatement(statement)) return [outcome(state, "continue")];
  if (ts.isFunctionDeclaration(statement) || ts.isEmptyStatement(statement)) {
    return [outcome(state)];
  }
  context.violation = true;
  return [outcome(state)];
};
