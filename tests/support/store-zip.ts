export interface ParsedStoreZipEntry {
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly externalAttributes: number;
  readonly flags: number;
  readonly method: number;
  readonly name: string;
  readonly time: number;
  readonly date: number;
}

const decoder = new TextDecoder();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const assertSignature = (
  view: DataView,
  offset: number,
  expected: number,
): void => {
  if (view.getUint32(offset, true) !== expected) {
    throw new Error(`Invalid ZIP signature at byte ${offset}.`);
  }
};

export const parseStoreZip = (
  input: Uint8Array,
): readonly ParsedStoreZipEntry[] => {
  if (input.byteLength < 22) throw new Error("ZIP is truncated.");
  const view = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  );
  const endOffset = input.byteLength - 22;
  assertSignature(view, endOffset, 0x06054b50);
  const count = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (centralOffset + centralSize !== endOffset) {
    throw new Error("ZIP central directory bounds are invalid.");
  }

  const entries: ParsedStoreZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assertSignature(view, cursor, 0x02014b50);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const time = view.getUint16(cursor + 12, true);
    const date = view.getUint16(cursor + 14, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(
      input.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    assertSignature(view, localOffset, 0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = decoder.decode(
      input.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    );
    if (localName !== name) throw new Error("ZIP entry names disagree.");
    const dataOffset =
      localOffset + 30 + localNameLength + localExtraLength;
    const body = input.slice(dataOffset, dataOffset + size);
    const descriptorOffset = dataOffset + size;
    assertSignature(view, descriptorOffset, 0x08074b50);
    if (
      view.getUint32(descriptorOffset + 4, true) !== expectedCrc ||
      view.getUint32(descriptorOffset + 8, true) !== size ||
      view.getUint32(descriptorOffset + 12, true) !== size ||
      crc32(body) !== expectedCrc
    ) {
      throw new Error("ZIP entry integrity check failed.");
    }
    entries.push({
      bytes: body,
      crc32: expectedCrc,
      date,
      externalAttributes,
      flags,
      method,
      name,
      time,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== endOffset) throw new Error("ZIP entry count is invalid.");
  return entries;
};
