import "server-only";

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const privateIpv4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^224\./,
  /^255\./,
];

const isPrivateIpv4 = (address: string): boolean => {
  if (privateIpv4.some((pattern) => pattern.test(address))) {
    return true;
  }
  const [first, second] = address.split(".").map(Number);
  return (
    first === 100 && second !== undefined && second >= 64 && second <= 127 ||
    first === 172 && second !== undefined && second >= 16 && second <= 31 ||
    first === 198 && (second === 18 || second === 19)
  );
};

const ipv6Bytes = (address: string): readonly number[] | null => {
  let normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const octets = normalized
      .slice(separator + 1)
      .split(".")
      .map(Number);
    if (
      separator < 0 ||
      octets.length !== 4 ||
      octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return null;
    }
    normalized = `${normalized.slice(0, separator + 1)}${(
      (octets[0] ?? 0) * 256 +
      (octets[1] ?? 0)
    ).toString(16)}:${(
      (octets[2] ?? 0) * 256 +
      (octets[3] ?? 0)
    ).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }
  const groups = (value: string | undefined): string[] =>
    value ? value.split(":").filter(Boolean) : [];
  const left = groups(halves[0]);
  const right = groups(halves[1]);
  const omitted = 8 - left.length - right.length;
  if (
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  ) {
    return null;
  }
  const expanded = [
    ...left,
    ...Array.from({ length: omitted }, () => "0"),
    ...right,
  ];
  if (
    expanded.length !== 8 ||
    expanded.some((group) => !/^[\da-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return expanded.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >>> 8, value & 0xff];
  });
};

const zeroRange = (
  bytes: readonly number[],
  start: number,
  end: number,
): boolean => bytes.slice(start, end).every((byte) => byte === 0);

const privateIpv4At = (bytes: readonly number[], offset: number): boolean =>
  isPrivateIpv4(bytes.slice(offset, offset + 4).join("."));

const hasPrivateEmbeddedIpv4 = (bytes: readonly number[]): boolean => {
  const mapped =
    zeroRange(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = zeroRange(bytes, 0, 12);
  const translated =
    zeroRange(bytes, 0, 8) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0;
  const nat64 =
    bytes[0] === 0 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeroRange(bytes, 4, 12);
  const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
  const isatap =
    (bytes[8] === 0 || bytes[8] === 0x02) &&
    bytes[9] === 0 &&
    bytes[10] === 0x5e &&
    bytes[11] === 0xfe;
  const teredo =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0 &&
    bytes[3] === 0;

  return (
    ((mapped || compatible || translated || nat64 || isatap) &&
      privateIpv4At(bytes, 12)) ||
    (sixToFour && privateIpv4At(bytes, 2)) ||
    (teredo &&
      isPrivateIpv4(
        bytes
          .slice(12, 16)
          .map((byte) => byte ^ 0xff)
          .join("."),
      ))
  );
};

const isPrivateIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  const bytes = ipv6Bytes(normalized);
  if (!bytes) {
    return true;
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    hasPrivateEmbeddedIpv4(bytes)
  );
};

export const isBlockedProviderAddress = (address: string): boolean => {
  const family = isIP(address);
  return family === 4
    ? isPrivateIpv4(address)
    : family === 6
      ? isPrivateIpv6(address)
      : true;
};

const configuredHosts = (): ReadonlySet<string> =>
  new Set(
    (process.env["VEDA_MAIL_ALLOWED_PROVIDER_HOSTS"] ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );

export const assertSafeProviderOrigin = async (value: string): Promise<URL> => {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";
  if (url.protocol !== "https:" && !(isLocal && process.env.NODE_ENV !== "production")) {
    throw new Error("Mail provider endpoints must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Provider credentials must not be included in the URL.");
  }

  const allowlist = configuredHosts();
  if (process.env.NODE_ENV === "production" && allowlist.size === 0) {
    throw new Error(
      "Configure VEDA_MAIL_ALLOWED_PROVIDER_HOSTS before connecting a provider.",
    );
  }
  if (allowlist.size > 0 && !allowlist.has(hostname)) {
    throw new Error("This mail provider host is not allowed by the server.");
  }
  if (isLocal && process.env.NODE_ENV !== "production") {
    return url;
  }
  if (isIP(hostname) !== 0 && isBlockedProviderAddress(hostname)) {
    throw new Error("Mail provider endpoints cannot use private network addresses.");
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedProviderAddress(address))
  ) {
    throw new Error("Mail provider endpoints cannot use private network addresses.");
  }
  return url;
};
