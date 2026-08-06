const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;

export const normalizeRequestId = (value: string | null): string | null => {
  const candidate = value?.trim() ?? "";
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : null;
};

export const resolveRequestId = (
  value: string | null,
  create: () => string = () => crypto.randomUUID(),
): string => normalizeRequestId(value) ?? create();
