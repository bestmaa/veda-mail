import ts from "typescript";

import { unwrapExpression } from "./session-scope-route-ast.mjs";
import { fieldValue } from "./session-scope-route-state.mjs";

export const expressionStaticTruth = (node) => {
  const target = unwrapExpression(node);
  if (target.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (
    target.kind === ts.SyntaxKind.FalseKeyword ||
    target.kind === ts.SyntaxKind.NullKeyword
  ) return false;
  if (
    ts.isPrefixUnaryExpression(target) &&
    target.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const nested = expressionStaticTruth(target.operand);
    return nested === null ? null : !nested;
  }
  return null;
};

const simpleValue = (node, state) => {
  const target = unwrapExpression(node);
  if (ts.isIdentifier(target)) return state.bindings.get(target.text);
  if (ts.isPropertyAccessExpression(target)) {
    const owner = simpleValue(target.expression, state);
    return owner ? fieldValue(owner, target.name.text) : null;
  }
  return null;
};

const narrowValue = (value, state, truthy) => {
  if (!value) return;
  if (truthy) {
    const restore = (candidate, token) => {
      if (candidate.connections?.has(token)) {
        candidate.exactConnections?.add(token);
        candidate.nullableConnections?.delete(token);
      }
      candidate.fields?.forEach((field) => restore(field, token));
    };
    value.nullableConnections?.forEach((token) =>
      state.bindings.forEach((candidate) => restore(candidate, token)),
    );
    value.nullableConnections?.clear();
    return;
  }
  for (const token of value.nullableConnections ?? []) {
    state.authenticated.delete(token);
    state.guarded.delete(token);
    state.waived.delete(token);
    value.connections.delete(token);
  }
};

export const narrowOptionalConnection = (node, state, truthy) => {
  const target = unwrapExpression(node);
  if (
    ts.isPrefixUnaryExpression(target) &&
    target.operator === ts.SyntaxKind.ExclamationToken
  ) {
    narrowOptionalConnection(target.operand, state, !truthy);
    return;
  }
  narrowValue(simpleValue(target, state), state, truthy);
};
