import ts from "typescript";

import { unwrapExpression } from "./session-scope-route-ast.mjs";

const copySet = (values) => new Set(values ?? []);
const uniqueNodes = (nodes) => [
  ...new Map((nodes ?? []).map((node) => [node.pos, node])).values(),
];

export const emptyValue = () => ({
  callables: [],
  connections: new Set(),
  exactConnections: new Set(),
  fields: null,
  importedCallable: false,
  nullableConnections: new Set(),
  primitives: new Set(),
  requestCarrier: false,
  requestDerived: false,
  requestFactory: false,
  requestObject: false,
  untrustedResult: false,
});

export const cloneValue = (value = emptyValue()) => ({
  callables: uniqueNodes(value.callables),
  connections: copySet(value.connections),
  exactConnections: copySet(value.exactConnections),
  fields:
    value.fields instanceof Map
      ? new Map(
          [...value.fields].map(([name, field]) => [name, cloneValue(field)]),
        )
      : null,
  importedCallable: Boolean(value.importedCallable),
  nullableConnections: copySet(value.nullableConnections),
  primitives: copySet(value.primitives),
  requestCarrier: Boolean(value.requestCarrier),
  requestDerived: Boolean(value.requestDerived),
  requestFactory: Boolean(value.requestFactory),
  requestObject: Boolean(value.requestObject),
  untrustedResult: Boolean(value.untrustedResult),
});

const unionBase = (values) => {
  const merged = emptyValue();
  for (const value of values.filter(Boolean)) {
    value.callables?.forEach((node) => merged.callables.push(node));
    value.connections?.forEach((token) => merged.connections.add(token));
    value.exactConnections?.forEach((token) =>
      merged.exactConnections.add(token),
    );
    value.primitives?.forEach((kind) => merged.primitives.add(kind));
    merged.importedCallable ||= Boolean(value.importedCallable);
    merged.requestCarrier ||= Boolean(value.requestCarrier);
    merged.requestFactory ||= Boolean(value.requestFactory);
    merged.untrustedResult ||= Boolean(value.untrustedResult);
  }
  merged.callables = uniqueNodes(merged.callables);
  return merged;
};

export const combineValues = (...values) => {
  const present = values.filter(Boolean);
  const merged = unionBase(present);
  merged.requestDerived = present.some((value) => value.requestDerived);
  merged.requestObject = present.some((value) => value.requestObject);
  return merged;
};

const intersection = (sets) => {
  if (sets.length === 0) return new Set();
  return new Set(
    [...sets[0]].filter((value) => sets.every((set) => set.has(value))),
  );
};

const alternativeFields = (values) => {
  if (!values.every((value) => value.fields instanceof Map)) return null;
  const names = new Set(values.flatMap((value) => [...value.fields.keys()]));
  return new Map(
    [...names].map((name) => [
      name,
      alternativeValues(
        ...values.map((value) => value.fields.get(name) ?? emptyValue()),
      ),
    ]),
  );
};

export const alternativeValues = (...values) => {
  const present = values.filter(Boolean);
  if (present.length === 0) return emptyValue();
  if (present.length === 1) return cloneValue(present[0]);
  const merged = unionBase(present);
  merged.exactConnections = intersection(
    present.map((value) => value.exactConnections ?? new Set()),
  );
  merged.fields = alternativeFields(present);
  merged.nullableConnections = intersection(
    present.map((value) => value.nullableConnections ?? new Set()),
  );
  merged.requestDerived = present.every((value) => value.requestDerived);
  merged.requestObject = present.every((value) => value.requestObject);
  return merged;
};

export const callableValue = (node) => ({
  ...emptyValue(),
  callables: [node],
});

export const primitiveValue = (kind) => ({
  ...emptyValue(),
  primitives: new Set([kind]),
});

export const objectValue = (fields) => {
  const entries = [...fields];
  const aggregate = combineValues(...entries.map(([, value]) => value));
  aggregate.fields = new Map(
    entries.map(([name, value]) => [name, cloneValue(value)]),
  );
  return aggregate;
};

export const fieldValue = (value, name) => {
  if (value.fields instanceof Map) {
    const field = value.fields.get(name);
    if (field) return cloneValue(field);
    if (value.importedCallable) {
      return { ...emptyValue(), importedCallable: true };
    }
    return emptyValue();
  }
  const result = cloneValue(value);
  result.fields = null;
  result.exactConnections.clear();
  result.nullableConnections.clear();
  result.requestCarrier = false;
  result.requestFactory = false;
  result.requestObject = false;
  return result;
};

const propertyName = (node) => {
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

export const bindName = (name, value, state, resolveDefault) => {
  if (ts.isIdentifier(name)) {
    state.bindings.set(name.text, cloneValue(value));
    return;
  }
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      const key = propertyName(element.propertyName ?? element.name);
      const field =
        element.dotDotDotToken || key === null
          ? combineValues(value)
          : fieldValue(value, key);
      const fallback =
        element.initializer && resolveDefault
          ? resolveDefault(element.initializer)
          : null;
      bindName(
        element.name,
        fallback ? alternativeValues(field, fallback) : field,
        state,
        resolveDefault,
      );
    }
    return;
  }
  if (ts.isArrayBindingPattern(name)) {
    name.elements.forEach((element, index) => {
      if (ts.isBindingElement(element)) {
        const field = fieldValue(value, String(index));
        const fallback =
          element.initializer && resolveDefault
            ? resolveDefault(element.initializer)
            : null;
        bindName(
          element.name,
          fallback ? alternativeValues(field, fallback) : field,
          state,
          resolveDefault,
        );
      }
    });
  }
};

export const cloneState = (state) => ({
  authenticated: copySet(state.authenticated),
  bindings: new Map(
    [...state.bindings].map(([name, value]) => [name, cloneValue(value)]),
  ),
  guarded: copySet(state.guarded),
  waived: copySet(state.waived),
});

export const mergeSecurityState = (target, states) => {
  target.authenticated = new Set(
    states.flatMap((state) => [...state.authenticated]),
  );
  target.guarded = new Set(
    [...target.authenticated].filter((token) =>
      states.every(
        (state) =>
          !state.authenticated.has(token) || state.guarded.has(token),
      ),
    ),
  );
  target.waived = new Set(
    [...target.authenticated].filter((token) =>
      states.every(
        (state) => !state.authenticated.has(token) || state.waived.has(token),
      ),
    ),
  );
};

export const mergeBranchStates = (target, states) => {
  mergeSecurityState(target, states);
  const names = new Set(states.flatMap((state) => [...state.bindings.keys()]));
  target.bindings = new Map(
    [...names].map((name) => [
      name,
      alternativeValues(...states.map((state) => state.bindings.get(name))),
    ]),
  );
};

export const markProtectedUse = (value, state, context) => {
  for (const token of value.connections) {
    if (state.authenticated.has(token) && !state.guarded.has(token)) {
      context.violation = true;
    }
  }
};
