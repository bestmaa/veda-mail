import ts from "typescript";

import {
  HTTP_METHODS,
  isFunctionLike,
  unwrapExpression,
} from "./session-scope-route-ast.mjs";

const hasExportModifier = (node) =>
  node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  ) ?? false;

const handlerRecord = (method, handler) => ({
  handler,
  method,
  unresolved: !handler?.body,
});

const immutableBindings = (sourceFile) =>
  new Set(
    sourceFile.statements.flatMap((statement) => {
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const)
      ) return [];
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    }),
  );

const containsClassSyntax = (node) => {
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (
      ts.isClassDeclaration(current) ||
      ts.isClassExpression(current)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
};

const unsafeModuleState = (sourceFile) =>
  sourceFile.statements.some(
    (statement) =>
      containsClassSyntax(statement) ||
      (ts.isVariableStatement(statement) &&
        !(statement.declarationList.flags & ts.NodeFlags.Const)) ||
      (ts.isExpressionStatement(statement) &&
        !ts.isStringLiteral(statement.expression)),
  );

const resolveExportCallable = (
  name,
  bindings,
  immutable,
  resolving = new Set(),
) => {
  if (!immutable.has(name) || resolving.has(name)) return null;
  const candidate = unwrapExpression(bindings.get(name));
  if (!candidate) return null;
  if (isFunctionLike(candidate)) return candidate;
  if (!ts.isIdentifier(candidate)) return null;
  return resolveExportCallable(
    candidate.text,
    bindings,
    immutable,
    new Set([...resolving, name]),
  );
};

const httpBindingNames = (name) => {
  if (ts.isIdentifier(name)) {
    return HTTP_METHODS.has(name.text) ? [name.text] : [];
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? httpBindingNames(element.name) : [],
    );
  }
  return [];
};

export const exportedHandlers = (sourceFile, bindings) => {
  const handlers = new Map();
  const immutable = immutableBindings(sourceFile);
  const unsafe = unsafeModuleState(sourceFile);
  const resolve = (name) =>
    unsafe ? null : resolveExportCallable(name, bindings, immutable);
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      HTTP_METHODS.has(statement.name.text) &&
      hasExportModifier(statement)
    ) {
      handlers.set(
        statement.name.text,
        handlerRecord(statement.name.text, null),
      );
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const method = declaration.name.text;
          if (!HTTP_METHODS.has(method)) continue;
          handlers.set(method, handlerRecord(method, resolve(method)));
          continue;
        }
        for (const method of httpBindingNames(declaration.name)) {
          handlers.set(method, handlerRecord(method, null));
        }
      }
    }
    if (!ts.isExportDeclaration(statement)) continue;
    if (!statement.exportClause) {
      handlers.set("*", handlerRecord("*", null));
      continue;
    }
    if (ts.isNamespaceExport(statement.exportClause)) {
      const method = statement.exportClause.name.text;
      if (HTTP_METHODS.has(method)) {
        handlers.set(method, handlerRecord(method, null));
      }
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const method = element.name.text;
      if (!HTTP_METHODS.has(method)) continue;
      const local = (element.propertyName ?? element.name).text;
      const handler = statement.moduleSpecifier ? null : resolve(local);
      handlers.set(method, handlerRecord(method, handler));
    }
  }
  return handlers;
};
