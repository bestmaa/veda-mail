import "server-only";

import type { MailRule } from "@/domain/mail/rule";
import type { VacationResponse, VacationResponseUpdate } from "@/domain/mail/vacation";
import type { CompiledStalwartSieveScript } from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";
import { createOwnedSieveCompiler } from "@/infrastructure/providers/sieve/sieve-owned-compiler";
import {
  composeOwnedSieveVacation,
  emptyOwnedSieveRulesRevision,
  emptySieveVacationRevision,
  ownedSieveRulesRevision,
  preserveOwnedSieveVacation,
} from "@/infrastructure/providers/sieve/sieve-vacation-compiler";
import { readOwnedSieveVacation } from "@/infrastructure/providers/sieve/sieve-vacation-reader";

export interface ManageSieveCompiler {
  compileRules(
    rules: readonly MailRule[],
    existingOwnedContent: string | null,
  ): CompiledStalwartSieveScript;
  compileVacation(
    existingOwnedContent: string | null,
    input: VacationResponseUpdate,
  ): CompiledStalwartSieveScript;
  readVacation(existingOwnedContent: string | null): VacationResponse;
  rulesRevision(existingOwnedContent: string | null): string;
  verifyOwnership(content: string): boolean;
}

export const createManageSieveCompiler = (
  mailboxNames: Readonly<Record<string, string>>,
): ManageSieveCompiler => {
  const owned = createOwnedSieveCompiler(mailboxNames);
  const empty = (): string => owned.compile([]).content;
  return {
    compileRules(rules, existingOwnedContent) {
      const result = preserveOwnedSieveVacation(
        owned.compile(rules).content,
        existingOwnedContent,
      );
      return { content: result.content, requiredExtensions: result.requiredExtensions };
    },
    compileVacation(existingOwnedContent, input) {
      const result = composeOwnedSieveVacation(existingOwnedContent ?? empty(), input);
      return { content: result.content, requiredExtensions: result.requiredExtensions };
    },
    readVacation(existingOwnedContent) {
      return existingOwnedContent === null ? {
        fromDate: null, htmlBody: null, isEnabled: false,
        revision: emptySieveVacationRevision(), subject: null, textBody: null, toDate: null,
      } : readOwnedSieveVacation(existingOwnedContent);
    },
    rulesRevision(existingOwnedContent) {
      return existingOwnedContent === null
        ? emptyOwnedSieveRulesRevision()
        : ownedSieveRulesRevision(existingOwnedContent);
    },
    verifyOwnership: owned.verifyOwnership,
  };
};
