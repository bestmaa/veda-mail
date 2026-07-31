import ts from "typescript";

import {
  isAuthWrapperExport,
  isAuthWrapperModule,
  isRequestUtilityExport,
  isRequestUtilityModule,
  knownAuthWrapperName,
  knownRequestUtilityName,
} from "./session-scope-route-import-effects.mjs";

export const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

const CONNECTION_MODULE = "@/server/connections/connection-session";
const SCOPE_MODULE = "@/server/connections/mail-session-scope";
const CONNECTION_EXPORT = "getCurrentConnection";
const REQUEST_SCOPE_EXPORT = "assertMailSessionScope";
const VALUE_SCOPE_EXPORT = "assertMailSessionScopeValue";

export const isFunctionLike = (node) =>
  ts.isArrowFunction(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isMethodDeclaration(node);

export const unwrapExpression = (node) => {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isAwaitExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

const targetSet = (result, moduleName, namespace = false) => {
  if (moduleName === CONNECTION_MODULE) {
    return namespace ? result.connectionNamespaces : result.connectionNames;
  }
  return namespace ? result.scopeNamespaces : result.scopeNames;
};

export const importBindings = (sourceFile) => {
  const result = {
    authWrapperNames: new Set(),
    authWrapperNamespaces: new Set(),
    connectionNames: new Set(),
    connectionNamespaces: new Set(),
    requestUtilityNames: new Set(),
    requestUtilityNamespaces: new Set(),
    scopeNames: new Map(),
    scopeNamespaces: new Set(),
    untrustedNames: new Set(),
    untrustedNamespaces: new Set(),
  };
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) result.untrustedNames.add(clause.name.text);
    const named = clause.namedBindings;
    if (ts.isNamespaceImport(named)) {
      result.untrustedNamespaces.add(named.name.text);
      if (isAuthWrapperModule(moduleName)) {
        result.authWrapperNamespaces.add(named.name.text);
      }
      if (isRequestUtilityModule(moduleName)) {
        result.requestUtilityNamespaces.add(named.name.text);
      }
      if ([CONNECTION_MODULE, SCOPE_MODULE].includes(moduleName)) {
        targetSet(result, moduleName, true).add(named.name.text);
      }
      continue;
    }
    if (!ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      const local = element.name.text;
      let classified = false;
      if (isAuthWrapperExport(moduleName, imported)) {
        result.authWrapperNames.add(local);
        classified = true;
      }
      if (isRequestUtilityExport(moduleName, imported)) {
        result.requestUtilityNames.add(local);
        classified = true;
      }
      if (moduleName === CONNECTION_MODULE && imported === CONNECTION_EXPORT) {
        result.connectionNames.add(local);
        classified = true;
      }
      if (
        moduleName === SCOPE_MODULE &&
        [REQUEST_SCOPE_EXPORT, VALUE_SCOPE_EXPORT].includes(imported)
      ) {
        result.scopeNames.set(
          local,
          imported === REQUEST_SCOPE_EXPORT ? "request-guard" : "value-guard",
        );
        classified = true;
      }
      if (!classified) result.untrustedNames.add(local);
    }
  }
  return result;
};

export const callableBindings = (sourceFile) => {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bindings.set(statement.name.text, statement);
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.set(statement.name.text, statement);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        bindings.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return bindings;
};

export const resolveCallable = (name, bindings, resolving = new Set()) => {
  if (resolving.has(name)) return null;
  const candidate = unwrapExpression(bindings.get(name));
  if (!candidate) return null;
  if (isFunctionLike(candidate)) return candidate;
  if (!ts.isIdentifier(candidate)) return null;
  const next = new Set(resolving);
  next.add(name);
  return resolveCallable(candidate.text, bindings, next);
};

export const primitiveReference = (expression, imports) => {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) {
    if (imports.authWrapperNames.has(target.text)) return "auth-wrapper";
    if (imports.requestUtilityNames.has(target.text)) return "request-utility";
    if (imports.connectionNames.has(target.text)) return "connection";
    return imports.scopeNames.get(target.text) ?? null;
  }
  if (
    !ts.isPropertyAccessExpression(target) ||
    !ts.isIdentifier(target.expression)
  ) {
    return null;
  }
  const namespace = target.expression.text;
  if (
    imports.authWrapperNamespaces.has(namespace) &&
    knownAuthWrapperName(target.name.text)
  ) {
    return "auth-wrapper";
  }
  if (
    imports.requestUtilityNamespaces.has(namespace) &&
    knownRequestUtilityName(target.name.text)
  ) {
    return "request-utility";
  }
  if (
    imports.connectionNamespaces.has(namespace) &&
    target.name.text === CONNECTION_EXPORT
  ) {
    return "connection";
  }
  if (!imports.scopeNamespaces.has(namespace)) return null;
  if (target.name.text === REQUEST_SCOPE_EXPORT) return "request-guard";
  return target.name.text === VALUE_SCOPE_EXPORT ? "value-guard" : null;
};

export const primitiveCall = (expression, imports) =>
  primitiveReference(expression, imports);
