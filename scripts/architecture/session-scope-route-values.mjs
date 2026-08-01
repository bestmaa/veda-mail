import ts from "typescript";

import {
  isFunctionLike,
  primitiveReference,
  resolveCallable,
  unwrapExpression,
} from "./session-scope-route-ast.mjs";
import { evaluateRouteCall } from "./session-scope-route-calls.mjs";
import {
  evaluateElement,
  evaluateNew,
  evaluateObject,
  evaluateProperty,
  updateProperty,
} from "./session-scope-route-composites.mjs";
import {
  alternativeValues,
  bindName,
  callableValue,
  cloneState,
  cloneValue,
  combineValues,
  emptyValue,
  mergeBranchStates,
  objectValue,
  primitiveValue,
} from "./session-scope-route-state.mjs";
import {
  expressionStaticTruth,
  narrowOptionalConnection,
} from "./session-scope-route-narrow.mjs";

const evaluateIdentifier = (node, state, context) => {
  if (state.bindings.has(node.text)) {
    return cloneValue(state.bindings.get(node.text));
  }
  const namespaceFields = new Map();
  const special = context.imports.specialNamespaces.get(node.text);
  if (special) {
    special.forEach((kind, name) => {
      namespaceFields.set(name, primitiveValue(kind));
    });
  }
  if (context.imports.connectionNamespaces.has(node.text)) {
    namespaceFields.set("getCurrentConnection", primitiveValue("connection"));
  }
  if (context.imports.scopeNamespaces.has(node.text)) {
    namespaceFields.set(
      "assertMailSessionScope",
      primitiveValue("request-guard"),
    );
    namespaceFields.set(
      "assertMailSessionScopeValue",
      primitiveValue("value-guard"),
    );
  }
  if (context.imports.authWrapperNamespaces.has(node.text)) {
    namespaceFields.set("getMailService", primitiveValue("auth-wrapper"));
  }
  if (context.imports.requestUtilityNamespaces.has(node.text)) {
    for (const name of [
      "assertRequestRateLimit",
      "assertSameOrigin",
      "readJsonBody",
    ]) {
      namespaceFields.set(name, primitiveValue("request-utility"));
    }
  }
  if (namespaceFields.size > 0) {
    const namespace = objectValue(namespaceFields);
    namespace.importedCallable = context.imports.untrustedNamespaces.has(
      node.text,
    );
    return namespace;
  }
  const primitive = primitiveReference(node, context.imports);
  if (primitive) return primitiveValue(primitive);
  if (
    context.imports.untrustedNames.has(node.text) ||
    context.imports.untrustedNamespaces.has(node.text)
  ) {
    return { ...emptyValue(), importedCallable: true };
  }
  const callable = resolveCallable(node.text, context.bindings);
  if (callable) return callableValue(callable);
  const candidate = context.bindings.get(node.text);
  if (!candidate || context.moduleStack.has(node.text)) return emptyValue();
  context.moduleStack.add(node.text);
  const value = evaluateExpression(candidate, cloneState(state), context);
  context.moduleStack.delete(node.text);
  return value;
};

const evaluateConditional = (node, state, context) => {
  const truth = expressionStaticTruth(node.condition);
  evaluateExpression(node.condition, state, context);
  const branches = [];
  const values = [];
  if (truth !== false) {
    const whenTrue = cloneState(state);
    narrowOptionalConnection(node.condition, whenTrue, true);
    values.push(evaluateExpression(node.whenTrue, whenTrue, context));
    branches.push(whenTrue);
  }
  if (truth !== true) {
    const whenFalse = cloneState(state);
    narrowOptionalConnection(node.condition, whenFalse, false);
    values.push(evaluateExpression(node.whenFalse, whenFalse, context));
    branches.push(whenFalse);
  }
  mergeBranchStates(state, branches);
  return alternativeValues(...values);
};

const evaluateLogical = (node, state, context) => {
  const left = evaluateExpression(node.left, state, context);
  const truth = expressionStaticTruth(node.left);
  const operator = node.operatorToken.kind;
  const rightOnTruthy = operator === ts.SyntaxKind.AmpersandAmpersandToken;
  const skipPossible =
    truth === null || (rightOnTruthy ? truth === false : truth === true);
  const rightPossible =
    truth === null || (rightOnTruthy ? truth === true : truth === false);
  const states = [];
  const values = [];
  if (skipPossible) {
    const skipped = cloneState(state);
    narrowOptionalConnection(node.left, skipped, !rightOnTruthy);
    states.push(skipped);
    values.push(left);
  }
  if (rightPossible) {
    const evaluated = cloneState(state);
    narrowOptionalConnection(node.left, evaluated, rightOnTruthy);
    states.push(evaluated);
    values.push(evaluateExpression(node.right, evaluated, context));
  }
  mergeBranchStates(state, states);
  return alternativeValues(...values);
};

const evaluateBinary = (node, state, context) => {
  const operator = node.operatorToken.kind;
  if (
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(operator)
  ) {
    return evaluateLogical(node, state, context);
  }
  if (operator === ts.SyntaxKind.CommaToken) {
    evaluateExpression(node.left, state, context);
    return evaluateExpression(node.right, state, context);
  }
  const left = evaluateExpression(node.left, state, context);
  const right = evaluateExpression(node.right, state, context);
  if (operator === ts.SyntaxKind.EqualsToken) {
    if (ts.isIdentifier(node.left)) bindName(node.left, right, state);
    else updateProperty(node.left, right, state, context);
    return right;
  }
  return combineValues(left, right);
};

export const evaluateExpression = (node, state, context) => {
  if (!node) return emptyValue();
  const target = unwrapExpression(node);
  if (target !== node) return evaluateExpression(target, state, context);
  if (ts.isIdentifier(target)) return evaluateIdentifier(target, state, context);
  if (isFunctionLike(target)) return callableValue(target);
  if (ts.isCallExpression(target)) {
    return evaluateRouteCall(target, state, context, evaluateExpression);
  }
  if (ts.isConditionalExpression(target)) {
    return evaluateConditional(target, state, context);
  }
  if (ts.isBinaryExpression(target)) {
    return evaluateBinary(target, state, context);
  }
  if (ts.isPropertyAccessExpression(target)) {
    return evaluateProperty(target, state, context, evaluateExpression);
  }
  if (ts.isElementAccessExpression(target)) {
    return evaluateElement(target, state, context, evaluateExpression);
  }
  if (ts.isNewExpression(target)) {
    return evaluateNew(target, state, context, evaluateExpression);
  }
  if (ts.isObjectLiteralExpression(target)) {
    return evaluateObject(target, state, context, evaluateExpression);
  }
  if (ts.isArrayLiteralExpression(target)) {
    return objectValue(
      target.elements.map((element, index) => [
        String(index),
        evaluateExpression(element, state, context),
      ]),
    );
  }
  if (
    ts.isPrefixUnaryExpression(target) ||
    ts.isPostfixUnaryExpression(target)
  ) {
    return evaluateExpression(target.operand, state, context);
  }
  if (ts.isTypeOfExpression(target) || ts.isVoidExpression(target)) {
    return evaluateExpression(target.expression, state, context);
  }
  if (ts.isTemplateExpression(target)) {
    return combineValues(
      ...target.templateSpans.map((span) =>
        evaluateExpression(span.expression, state, context),
      ),
    );
  }
  return emptyValue();
};
