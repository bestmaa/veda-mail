import ts from "typescript";

import {
  primitiveReference,
  unwrapExpression,
} from "./session-scope-route-ast.mjs";
import {
  cloneValue,
  combineValues,
  callableValue,
  emptyValue,
  fieldValue,
  markProtectedUse,
  objectValue,
  primitiveValue,
} from "./session-scope-route-state.mjs";

const staticName = (node) => {
  const target = unwrapExpression(node);
  if (
    ts.isIdentifier(target) ||
    ts.isStringLiteral(target) ||
    ts.isNumericLiteral(target)
  ) {
    return target.text;
  }
  return null;
};

export const evaluateProperty = (
  node,
  state,
  context,
  evaluateExpression,
) => {
  const primitive = primitiveReference(node, context.imports);
  if (primitive) return primitiveValue(primitive);
  const owner = evaluateExpression(node.expression, state, context);
  const result = fieldValue(owner, node.name.text);
  if (owner.requestObject && node.name.text === "clone") {
    result.requestFactory = true;
  }
  return result;
};

export const evaluateElement = (
  node,
  state,
  context,
  evaluateExpression,
) => {
  const owner = evaluateExpression(node.expression, state, context);
  const name = staticName(node.argumentExpression);
  if (name !== null) {
    const result = fieldValue(owner, name);
    if (owner.requestObject && name === "clone") result.requestFactory = true;
    return result;
  }
  context.violation ||=
    owner.connections.size > 0 ||
    owner.primitives.size > 0 ||
    owner.callables.length > 0;
  return combineValues(
    owner,
    evaluateExpression(node.argumentExpression, state, context),
  );
};

export const evaluateObject = (
  node,
  state,
  context,
  evaluateExpression,
) => {
  const fields = new Map();
  let unknown = emptyValue();
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = evaluateExpression(property.expression, state, context);
      if (spread.fields instanceof Map) {
        spread.fields.forEach((value, name) => fields.set(name, value));
      } else {
        unknown = combineValues(unknown, spread);
      }
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      fields.set(
        property.name.text,
        evaluateExpression(property.name, state, context),
      );
      continue;
    }
    if (ts.isMethodDeclaration(property)) {
      const name = staticName(property.name);
      if (name === null) context.violation = true;
      else fields.set(name, callableValue(property));
      continue;
    }
    if (
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      context.violation = true;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = staticName(property.name);
    const value = evaluateExpression(property.initializer, state, context);
    if (name === null) {
      context.violation ||= value.connections.size > 0;
      unknown = combineValues(unknown, value);
    } else {
      fields.set(name, value);
    }
  }
  const result = objectValue(fields);
  if (unknown.primitives.size > 0 || unknown.callables.length > 0) {
    context.violation = true;
  }
  if (
    unknown.connections.size === 0 &&
    !unknown.requestDerived &&
    unknown.primitives.size === 0 &&
    unknown.callables.length === 0
  ) {
    return result;
  }
  markProtectedUse(unknown, state, context);
  return combineValues(result, unknown);
};

export const updateProperty = (left, value, state, context) => {
  if (
    !ts.isPropertyAccessExpression(left) ||
    !ts.isIdentifier(unwrapExpression(left.expression))
  ) {
    markProtectedUse(value, state, context);
    context.violation ||=
      value.primitives.size > 0 ||
      value.callables.length > 0 ||
      value.importedCallable ||
      value.untrustedResult;
    return;
  }
  const ownerName = unwrapExpression(left.expression).text;
  const owner = cloneValue(state.bindings.get(ownerName));
  if (!(owner.fields instanceof Map)) {
    context.violation ||=
      value.connections.size > 0 ||
      value.callables.length > 0 ||
      value.importedCallable ||
      value.primitives.size > 0;
    return;
  }
  owner.fields.set(left.name.text, cloneValue(value));
  state.bindings.set(ownerName, objectValue(owner.fields));
};

export const evaluateNew = (
  node,
  state,
  context,
  evaluateExpression,
) => {
  if (ts.isIdentifier(node.expression)) {
    const candidate = context.bindings.get(node.expression.text);
    if (
      candidate &&
      (ts.isClassDeclaration(candidate) || ts.isClassExpression(candidate))
    ) {
      context.violation = true;
    }
  }
  const values = [
    evaluateExpression(node.expression, state, context),
    ...(node.arguments ?? []).map((argument) =>
      evaluateExpression(argument, state, context),
    ),
  ];
  const constructor = values[0];
  if (
    constructor.importedCallable ||
    constructor.untrustedResult ||
    [...constructor.primitives].some((kind) => kind !== "request-utility")
  ) {
    context.violation = true;
  }
  values.forEach((value) => context.inspectCallback(value, state));
  const result = combineValues(...values);
  result.callables = [];
  result.primitives.clear();
  result.requestFactory = false;
  result.requestObject = false;
  context.recordThrow(state);
  markProtectedUse(result, state, context);
  return result;
};
