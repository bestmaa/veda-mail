import "server-only";

import type { MailRule } from "@/domain/mail/rule";

export interface CompiledStalwartSieveScript {
  readonly content: string;
  readonly requiredExtensions: readonly string[];
}

export interface StalwartSieveCompiler {
  compile(rules: readonly MailRule[]): CompiledStalwartSieveScript;
  verifyOwnership(content: string): boolean;
}

export interface StalwartSieveContentPort {
  download(input: {
    readonly accountId: string;
    readonly blobId: string;
    readonly maxBytes: number;
  }): Promise<Uint8Array>;
  upload(input: {
    readonly accountId: string;
    readonly content: Uint8Array;
    readonly mediaType: "application/sieve";
  }): Promise<{
    readonly accountId: string;
    readonly blobId: string;
    readonly mediaType: string;
    readonly size: number;
  }>;
}
