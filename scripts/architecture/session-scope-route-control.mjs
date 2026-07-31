import ts from "typescript";

import {
  bindName,
  cloneState,
  emptyValue,
} from "./session-scope-route-state.mjs";
import { expressionStaticTruth } from "./session-scope-route-narrow.mjs";

const runCatch = (
  statement,
  states,
  context,
  depth,
  runStatements,
  outcome,
  evaluateAt,
) =>
  states.flatMap((entry) => {
    const caught = cloneState(entry);
    caught.authenticated.forEach((token) => caught.waived.add(token));
    const declaration = statement.catchClause.variableDeclaration;
    if (declaration) {
      bindName(
        declaration.name,
        emptyValue(),
        caught,
        (initializer) => evaluateAt(initializer, caught, context, depth),
      );
    }
    return runStatements(
      statement.catchClause.block.statements,
      [outcome(caught)],
      context,
      depth,
    );
  });

const applyFinally = (
  block,
  outcomes,
  context,
  depth,
  runStatements,
  outcome,
) => {
  if (!block) return outcomes;
  return outcomes.flatMap((current) => {
    const finalized = runStatements(
      block.statements,
      [outcome(cloneState(current.state))],
      context,
      depth,
    );
    return finalized.map((result) =>
      result.kind === "normal"
        ? outcome(result.state, current.kind, current.value)
        : result,
    );
  });
};

export const runTryControl = (
  statement,
  state,
  context,
  depth,
  runStatements,
  outcome,
  evaluateAt,
) => {
  const thrownStates = [];
  const beforeEvents = context.securityEvents;
  context.throwCollectors.push(thrownStates);
  const attempted = runStatements(
    statement.tryBlock.statements,
    [outcome(cloneState(state))],
    context,
    depth,
  );
  context.throwCollectors.pop();
  const tryHadSecurity = context.securityEvents > beforeEvents;
  attempted
    .filter(({ kind }) => kind === "throw")
    .forEach(({ state: thrown }) => thrownStates.push(thrown));
  const completed = attempted.filter(({ kind }) => kind !== "throw");
  let caught = [];
  if (statement.catchClause) {
    if (thrownStates.length === 0) thrownStates.push(cloneState(state));
    caught = runCatch(
      statement,
      thrownStates,
      context,
      depth,
      runStatements,
      outcome,
      evaluateAt,
    );
    if (
      tryHadSecurity &&
      caught.some(({ kind }) => kind === "normal")
    ) {
      context.violation = true;
    }
  }
  return applyFinally(
    statement.finallyBlock,
    statement.catchClause
      ? [...completed, ...caught]
      : [
          ...completed,
          ...thrownStates.map((thrown) => outcome(thrown, "throw")),
        ],
    context,
    depth,
    runStatements,
    outcome,
  );
};

const initializeFor = (
  statement,
  state,
  context,
  depth,
  evaluateAt,
  runVariableStatement,
) => {
  const initializer = statement.initializer;
  if (!initializer) return;
  if (ts.isVariableDeclarationList(initializer)) {
    const variable = ts.factory.createVariableStatement(undefined, initializer);
    runVariableStatement(variable, state, context, depth);
  } else {
    evaluateAt(initializer, state, context, depth);
  }
};

const initializeForEach = (
  statement,
  state,
  context,
  depth,
  evaluateAt,
) => {
  const collection = evaluateAt(statement.expression, state, context, depth);
  if (ts.isVariableDeclarationList(statement.initializer)) {
    for (const declaration of statement.initializer.declarations) {
      bindName(
        declaration.name,
        collection,
        state,
        (initializer) => evaluateAt(initializer, state, context, depth),
      );
    }
  } else {
    evaluateAt(statement.initializer, state, context, depth);
  }
};

export const runLoopControl = (
  statement,
  state,
  context,
  depth,
  helpers,
) => {
  const { evaluateAt, outcome, runStatement, runVariableStatement } = helpers;
  const beforeSecurity = context.securityEvents;
  if (ts.isForStatement(statement)) {
    initializeFor(
      statement,
      state,
      context,
      depth,
      evaluateAt,
      runVariableStatement,
    );
  }
  if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    initializeForEach(statement, state, context, depth, evaluateAt);
  }
  const condition =
    ts.isForStatement(statement) || ts.isWhileStatement(statement)
      ? statement.condition ?? statement.expression
      : ts.isDoStatement(statement)
        ? statement.expression
        : null;
  const truth = condition ? expressionStaticTruth(condition) : true;
  if (condition) evaluateAt(condition, state, context, depth);
  const results = [];
  if (!ts.isDoStatement(statement) && truth !== true) {
    results.push(outcome(cloneState(state)));
  }
  if (truth !== false || ts.isDoStatement(statement)) {
    const body = runStatement(
      statement.statement,
      cloneState(state),
      context,
      depth,
    );
    for (const result of body) {
      if (
        result.kind === "normal" ||
        result.kind === "break" ||
        result.kind === "continue"
      ) {
        if (ts.isForStatement(statement) && statement.incrementor) {
          evaluateAt(statement.incrementor, result.state, context, depth);
        }
        results.push(outcome(result.state));
      } else {
        results.push(result);
      }
    }
  }
  if (context.securityEvents > beforeSecurity) context.violation = true;
  return results;
};
