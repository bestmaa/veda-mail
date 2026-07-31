import ts from "typescript";

import {
  callableBindings,
  resolveCallable,
  unwrapExpression,
} from "./session-scope-route-ast.mjs";
import { exportedHandlers } from "./session-scope-route-exports.mjs";

const AUTH_MODULE = "@/server/auth/admin-session";
const ORIGIN_MODULE = "@/server/installation/request-origin";
const MUTATIONS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

const securityImports = (sourceFile) => {
  const result = {
    authNames: new Set(),
    authNamespaces: new Set(),
    originNames: new Set(),
    originNamespaces: new Set(),
  };
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      ![AUTH_MODULE, ORIGIN_MODULE].includes(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    const named = clause?.namedBindings;
    if (!clause || clause.isTypeOnly || !named) continue;
    const isAuth = statement.moduleSpecifier.text === AUTH_MODULE;
    if (ts.isNamespaceImport(named)) {
      (isAuth ? result.authNamespaces : result.originNamespaces).add(
        named.name.text,
      );
      continue;
    }
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (isAuth && imported === "assertAdminAccess") {
        result.authNames.add(element.name.text);
      }
      if (!isAuth && imported === "assertSameOrigin") {
        result.originNames.add(element.name.text);
      }
    }
  }
  return result;
};

const isPrimitive = (expression, kind, imports) => {
  const target = unwrapExpression(expression);
  const names = kind === "auth" ? imports.authNames : imports.originNames;
  const namespaces =
    kind === "auth" ? imports.authNamespaces : imports.originNamespaces;
  const exportName = kind === "auth" ? "assertAdminAccess" : "assertSameOrigin";
  return (
    (ts.isIdentifier(target) && names.has(target.text)) ||
    (ts.isPropertyAccessExpression(target) &&
      ts.isIdentifier(target.expression) &&
      namespaces.has(target.expression.text) &&
      target.name.text === exportName)
  );
};

const callableInvokes = (
  callable,
  kind,
  imports,
  bindings,
  visited = new Set(),
) => {
  if (!callable?.body || visited.has(callable.pos)) return false;
  const nextVisited = new Set(visited).add(callable.pos);
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      if (isPrimitive(node.expression, kind, imports)) {
        found = true;
        return;
      }
      const target = unwrapExpression(node.expression);
      if (ts.isIdentifier(target)) {
        const helper = resolveCallable(target.text, bindings);
        if (
          helper &&
          callableInvokes(helper, kind, imports, bindings, nextVisited)
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callable.body);
  return found;
};

export const adminRouteHandlerViolations = (
  fileName,
  source,
  allowedUnauthenticatedHandlers = new Set(),
) => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bindings = callableBindings(sourceFile);
  const imports = securityImports(sourceFile);
  const violations = [];
  for (const [method, record] of exportedHandlers(sourceFile, bindings)) {
    if (record.unresolved || !record.handler) {
      violations.push(`${method}:unresolved`);
      continue;
    }
    if (
      !allowedUnauthenticatedHandlers.has(method) &&
      !callableInvokes(record.handler, "auth", imports, bindings)
    ) {
      violations.push(`${method}:admin-access`);
    }
    if (
      MUTATIONS.has(method) &&
      !callableInvokes(record.handler, "origin", imports, bindings)
    ) {
      violations.push(`${method}:same-origin`);
    }
  }
  return [...new Set(violations)].sort();
};
