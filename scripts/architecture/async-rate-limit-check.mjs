import ts from "typescript";

const RATE_LIMIT_MODULE = "@/server/security/rate-limit";
const ASYNC_EXPORTS = new Set([
  "assertRequestRateLimit",
  "assertSubjectRateLimit",
]);

const bindings = (sourceFile) => {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== RATE_LIMIT_MODULE
    ) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (ASYNC_EXPORTS.has(imported)) names.add(element.name.text);
    }
  }
  return names;
};

export const unawaitedRateLimitCalls = (fileName, source) => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = bindings(sourceFile);
  const violations = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text) &&
      !ts.isAwaitExpression(node.parent)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      violations.push(line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
};
