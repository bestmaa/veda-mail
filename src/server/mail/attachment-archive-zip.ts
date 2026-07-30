import "server-only";

const encoder = new TextEncoder();
const ZIP_FLAGS = 0x0808;
const ZIP_METHOD_STORE = 0;
const ZIP_TIME = 0;
const ZIP_DATE = 0x0021;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const bytes = (length: number): [Uint8Array, DataView] => {
  const output = new Uint8Array(length);
  return [output, new DataView(output.buffer)];
};

const u16 = (view: DataView, offset: number, value: number): void =>
  view.setUint16(offset, value, true);

const u32 = (view: DataView, offset: number, value: number): void =>
  view.setUint32(offset, value >>> 0, true);

const assertClassicZipNumber = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("The attachment archive exceeded classic ZIP limits.");
  }
};

export const updateZipCrc32 = (
  current: number,
  chunk: Uint8Array,
): number => {
  let value = current;
  for (const byte of chunk) {
    value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return value >>> 0;
};

export const finishZipCrc32 = (current: number): number =>
  (current ^ 0xffffffff) >>> 0;

export const createZipLocalHeader = (name: string): Uint8Array => {
  const nameBytes = encoder.encode(name);
  const [output, view] = bytes(30 + nameBytes.byteLength);
  u32(view, 0, 0x04034b50);
  u16(view, 4, 20);
  u16(view, 6, ZIP_FLAGS);
  u16(view, 8, ZIP_METHOD_STORE);
  u16(view, 10, ZIP_TIME);
  u16(view, 12, ZIP_DATE);
  u16(view, 26, nameBytes.byteLength);
  output.set(nameBytes, 30);
  return output;
};

export const createZipDataDescriptor = (
  crc32: number,
  size: number,
): Uint8Array => {
  assertClassicZipNumber(size);
  const [output, view] = bytes(16);
  u32(view, 0, 0x08074b50);
  u32(view, 4, crc32);
  u32(view, 8, size);
  u32(view, 12, size);
  return output;
};

export interface ZipCentralEntry {
  readonly crc32: number;
  readonly localOffset: number;
  readonly name: string;
  readonly size: number;
}

export const createZipCentralEntry = (
  entry: ZipCentralEntry,
): Uint8Array => {
  assertClassicZipNumber(entry.localOffset);
  assertClassicZipNumber(entry.size);
  const nameBytes = encoder.encode(entry.name);
  const [output, view] = bytes(46 + nameBytes.byteLength);
  u32(view, 0, 0x02014b50);
  u16(view, 4, 0x0314);
  u16(view, 6, 20);
  u16(view, 8, ZIP_FLAGS);
  u16(view, 10, ZIP_METHOD_STORE);
  u16(view, 12, ZIP_TIME);
  u16(view, 14, ZIP_DATE);
  u32(view, 16, entry.crc32);
  u32(view, 20, entry.size);
  u32(view, 24, entry.size);
  u16(view, 28, nameBytes.byteLength);
  u32(view, 38, 0o100600 << 16);
  u32(view, 42, entry.localOffset);
  output.set(nameBytes, 46);
  return output;
};

export const createZipEnd = (
  count: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array => {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff) {
    throw new Error("The attachment archive has too many ZIP entries.");
  }
  assertClassicZipNumber(centralSize);
  assertClassicZipNumber(centralOffset);
  const [output, view] = bytes(22);
  u32(view, 0, 0x06054b50);
  u16(view, 8, count);
  u16(view, 10, count);
  u32(view, 12, centralSize);
  u32(view, 16, centralOffset);
  return output;
};
