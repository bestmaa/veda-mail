import "server-only";

const MAX_DRAFT_MIME_DEPTH = 16;
const MAX_DRAFT_MIME_PARTS = 256;

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const shallowParts = (value: unknown): unknown[] =>
  (Array.isArray(value) ? value.slice(0, MAX_DRAFT_MIME_PARTS) : []).map(
    (part) => {
      const record = objectRecord(part);
      return record
        ? {
            ...record,
            headers: Array.isArray(record["headers"])
              ? record["headers"].slice(0, MAX_DRAFT_MIME_PARTS)
              : record["headers"],
            subParts: null,
          }
        : part;
    },
  );

const unsupportedStructure = (
  email: Record<string, unknown>,
): Record<string, unknown> => ({
  ...email,
  attachments: shallowParts(email["attachments"]),
  bodyStructure: undefined,
  bodyStructureUnsafe: true,
  htmlBody: shallowParts(email["htmlBody"]),
  textBody: shallowParts(email["textBody"]),
});

export const boundStalwartDraftStructure = (value: unknown): unknown => {
  const email = objectRecord(value);
  if (!email) return value;
  const roots = [
    email["bodyStructure"],
    ...(Array.isArray(email["attachments"]) ? email["attachments"] : []),
    ...(Array.isArray(email["htmlBody"]) ? email["htmlBody"] : []),
    ...(Array.isArray(email["textBody"]) ? email["textBody"] : []),
  ];
  const stack = roots.map((node) => ({ depth: 1, node }));
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    const part = objectRecord(current.node);
    if (!part) continue;
    count += 1;
    if (count > MAX_DRAFT_MIME_PARTS || current.depth > MAX_DRAFT_MIME_DEPTH) {
      return unsupportedStructure(email);
    }
    if (
      Array.isArray(part["headers"]) &&
      part["headers"].length > MAX_DRAFT_MIME_PARTS
    ) {
      return unsupportedStructure(email);
    }
    const children = part["subParts"];
    if (Array.isArray(children)) {
      for (const child of children) {
        stack.push({ depth: current.depth + 1, node: child });
      }
    }
  }
  return value;
};
