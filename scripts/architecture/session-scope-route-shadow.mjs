import ts from "typescript";

const bindingIdentifiers = (name) => {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingIdentifiers(element.name) : [],
    );
  }
  return [];
};

const primitiveNames = (imports) =>
  new Set([
    ...imports.authWrapperNames,
    ...imports.authWrapperNamespaces,
    ...imports.connectionNames,
    ...imports.connectionNamespaces,
    ...imports.scopeNames.keys(),
    ...imports.scopeNamespaces,
  ]);

export const callableShadowsPrimitive = (callable, imports) => {
  const protectedNames = primitiveNames(imports);
  if (protectedNames.size === 0) return false;
  let shadowed = false;
  const inspect = (node) => {
    if (shadowed) return;
    let names = [];
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      names = bindingIdentifiers(node.name);
    } else if (ts.isFunctionDeclaration(node) && node !== callable && node.name) {
      names = [node.name.text];
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      names = bindingIdentifiers(node.variableDeclaration.name);
    }
    if (names.some((name) => protectedNames.has(name))) {
      shadowed = true;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  ts.forEachChild(callable, inspect);
  return shadowed;
};

export const callableUsesUnsupportedSyntax = (callable) => {
  let unsupported = false;
  const inspect = (node) => {
    if (unsupported) return;
    if (
      node.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isIdentifier(node) && node.text === "arguments") ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isYieldExpression(node)
    ) {
      unsupported = true;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  ts.forEachChild(callable, inspect);
  return unsupported;
};
