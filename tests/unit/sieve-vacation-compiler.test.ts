import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VacationResponseUpdate } from "@/domain/mail/vacation";
import {
  createOwnedSieveCompiler,
  decodeOwnedSieveBody,
  encodeOwnedSieveBody,
} from "@/infrastructure/providers/sieve/sieve-owned-compiler";
import {
  composeOwnedSieveVacation,
  ownedSieveRulesRevision,
  preserveOwnedSieveVacation,
} from "@/infrastructure/providers/sieve/sieve-vacation-compiler";
import { readOwnedSieveVacation } from "@/infrastructure/providers/sieve/sieve-vacation-reader";

const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
const compiler = () => createOwnedSieveCompiler({});
const update = (overrides: Partial<VacationResponseUpdate> = {}): VacationResponseUpdate => ({
  expectedRevision: "expected",
  fromDate: null,
  htmlBody: null,
  isEnabled: true,
  subject: "Away",
  textBody: "I am away.\n.Please leave a message.",
  toDate: null,
  ...overrides,
});

beforeEach(() => {
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
});

describe("owned Sieve vacation composition", () => {
  it("adds a signed vacation block and dot-stuffs text literals", () => {
    const ownedRules = compiler().compile([]).content;
    const result = composeOwnedSieveVacation(ownedRules, update());
    const body = decodeOwnedSieveBody(result.content);

    expect(body).toContain('require ["vacation"];');
    expect(body).toContain('vacation :days 1 :subject "Away" text:');
    expect(body).toContain("\r\n..Please leave a message.\r\n.\r\n;");
    expect(result.requiredExtensions).toEqual(["vacation"]);
    expect(compiler().verifyOwnership(result.content)).toBe(true);
    expect(readOwnedSieveVacation(result.content)).toMatchObject({
      isEnabled: true, subject: "Away", textBody: "I am away.\n.Please leave a message.",
    });
  });

  it("adds bounded date tests and preserves the block across rule recompilation", () => {
    const first = composeOwnedSieveVacation(compiler().compile([]).content, update({
      fromDate: "2026-08-12T08:00:00Z",
      toDate: "2026-08-20T08:00:00Z",
    }));
    const nextRules = compiler().compile([]).content.replace(
      "# Veda Mail generated rules v1. Do not edit.",
      "# Veda Mail generated rules v1. Do not edit.\r\nkeep;",
    );
    const resignedRules = compiler().compile([]).content;
    const preserved = preserveOwnedSieveVacation(resignedRules, first.content);
    const body = decodeOwnedSieveBody(preserved.content);

    expect(body).toContain('require ["date", "relational", "vacation"];');
    expect(body).toContain('currentdate :value "ge" "iso8601" "2026-08-12T08:00:00Z"');
    expect(body).toContain('currentdate :value "lt" "iso8601" "2026-08-20T08:00:00Z"');
    expect(preserved.revision).toBe(first.revision);
    expect(nextRules).not.toBe(resignedRules);
  });

  it("removes vacation without changing the owned rules program", () => {
    const rules = compiler().compile([]).content;
    const enabled = composeOwnedSieveVacation(rules, update());
    const disabled = composeOwnedSieveVacation(enabled.content, update({ isEnabled: false }));

    expect(decodeOwnedSieveBody(disabled.content)).toBe(decodeOwnedSieveBody(rules));
    expect(disabled.requiredExtensions).toEqual([]);
    expect(readOwnedSieveVacation(disabled.content)).toMatchObject({
      isEnabled: false, subject: null,
    });
  });

  it("keeps the rules revision stable across vacation-only changes", () => {
    const rules = compiler().compile([]).content;
    const enabled = composeOwnedSieveVacation(rules, update()).content;
    expect(ownedSieveRulesRevision(enabled)).toBe(ownedSieveRulesRevision(rules));
  });

  it("renders HTML as a deterministic MIME alternative without raw markup in commands", () => {
    const result = composeOwnedSieveVacation(compiler().compile([]).content, update({
      htmlBody: "<p>Private <strong>HTML</strong></p>",
    }));
    const body = decodeOwnedSieveBody(result.content)!;
    expect(body).toContain(" :mime text:");
    expect(body).toContain("Content-Type: multipart/alternative;");
    expect(body).not.toContain("<strong>");
    expect(readOwnedSieveVacation(result.content).htmlBody)
      .toBe("<p>Private <strong>HTML</strong></p>");
  });

  it("rejects tampered and ambiguous owned content", () => {
    const rules = compiler().compile([]).content;
    expect(() => composeOwnedSieveVacation(rules.replace("generated", "changed"), update()))
      .toThrow("not owned");
    const enabled = composeOwnedSieveVacation(rules, update());
    const body = decodeOwnedSieveBody(enabled.content)!;
    const duplicate = body.replace(
      "# Veda-Mail-Vacation-v1-End\r\n",
      "# Veda-Mail-Vacation-v1-End\r\n# Veda-Mail-Vacation-v1-Begin\r\n",
    );
    const signedDuplicate = encodeOwnedSieveBody(duplicate);
    expect(() => composeOwnedSieveVacation(signedDuplicate, update({ isEnabled: false })))
      .toThrow("ambiguous");
  });
});
