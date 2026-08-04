import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type { MailRule } from "@/domain/mail/rule";
import {
  compileMailRulesToSieveProgram,
} from "@/infrastructure/providers/sieve/sieve-compiler";
import type {
  CompiledStalwartSieveScript,
  StalwartSieveCompiler,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";
import { ruleSubkey } from "@/server/rules/rule-key";

const MARKER = "# Veda-Mail-Owned-v1: ";
const MAX_SCRIPT_BYTES = 256 * 1024;
const COMPILER_EXTENSIONS = [
  "envelope",
  "fileinto",
  "foreverypart",
  "imap4flags",
  "mime",
  "variables",
] as const;

const bodyHash = (body: string): string =>
  createHash("sha256").update(body, "utf8").digest("base64url");

const signature = (hash: string): string =>
  createHmac("sha256", ruleSubkey("sieve-ownership"))
    .update(`veda-mail/sieve-script/v1\0${hash}`, "utf8")
    .digest("base64url");

const safeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes);
};

const ownedContent = (body: string): string => {
  const hash = bodyHash(body);
  return `${MARKER}${hash}.${signature(hash)}\r\n${body}`;
};

const verifyOwnedContent = (content: string): boolean => {
  const separator = content.indexOf("\r\n");
  if (separator < 0 || !content.startsWith(MARKER)) return false;
  const marker = content.slice(MARKER.length, separator);
  const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/u.exec(marker);
  if (!match) return false;
  const body = content.slice(separator + 2);
  const actualHash = bodyHash(body);
  return safeEqual(match[1]!, actualHash) &&
    safeEqual(match[2]!, signature(actualHash));
};

export const createOwnedSieveCompiler = (
  mailboxNames: Readonly<Record<string, string>>,
): StalwartSieveCompiler => ({
  compile(rules: readonly MailRule[]): CompiledStalwartSieveScript {
    const program = compileMailRulesToSieveProgram({
      capabilities: {
        extensions: COMPILER_EXTENSIONS,
        maxScriptBytes: MAX_SCRIPT_BYTES - 100,
      },
      mailboxNames,
      rules,
    });
    const content = ownedContent(program.content);
    if (Buffer.byteLength(content, "utf8") > MAX_SCRIPT_BYTES) {
      throw new Error("The generated Sieve script is too large.");
    }
    return { content, requiredExtensions: program.requiredExtensions };
  },
  verifyOwnership: verifyOwnedContent,
});
