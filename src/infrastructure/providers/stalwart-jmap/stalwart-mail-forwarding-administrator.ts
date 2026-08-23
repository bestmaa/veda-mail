import "server-only";

import type { MailForwardingConfiguration } from "@/domain/admin/mail-forwarding";
import {
  decodeOwnedSieveBody,
  encodeOwnedSieveBody,
} from "@/infrastructure/providers/sieve/sieve-owned-compiler";
import {
  stalwartGetResultSchema,
  stalwartMtaStageDataSchema,
  stalwartQueryResultSchema,
  stalwartSetResultSchema,
  stalwartSystemScriptSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";
import { StalwartManagementClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";

export const VEDA_FORWARDING_SCRIPT_NAME = "veda-mail-admin-forwarding-v1";
const DESCRIPTION = "Managed by Veda Mail. Do not edit manually.";
const MAX_SCRIPT_BYTES = 256 * 1_024;
const stageSelection = { else: VEDA_FORWARDING_SCRIPT_NAME } as const;
const disabledSelection = { else: "false" } as const;

const sieveString = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export const compileStalwartForwardingScript = (
  entries: readonly MailForwardingConfiguration[],
): string => {
  const rules = entries.flatMap((entry) => entry.sourceAddresses.map((address) => ({
    address, destinationEmail: entry.destinationEmail,
  }))).sort((left, right) => left.address.localeCompare(right.address))
    .map((entry) => [
      `if envelope :is "to" ${sieveString(entry.address)} {`,
      `  redirect :copy ${sieveString(entry.destinationEmail)};`,
      "}",
    ].join("\n"));
  const content = encodeOwnedSieveBody([
    "# Managed by Veda Mail. Manual edits are replaced.",
    'require ["copy", "envelope"];',
    ...rules,
    "",
  ].join("\n"));
  if (Buffer.byteLength(content, "utf8") > MAX_SCRIPT_BYTES) {
    throw new RangeError("The forwarding program exceeds its safe size limit.");
  }
  return content;
};

const isSelection = (value: unknown, expected: unknown): boolean =>
  JSON.stringify(value) === JSON.stringify(expected);
const assertSet = (
  result: ReturnType<typeof stalwartSetResultSchema.parse>,
  kind: "created" | "updated",
  id: string,
) => {
  const rejected = kind === "created" ? result.notCreated : result.notUpdated;
  if (rejected && Object.keys(rejected).length) throw new Error("provider-rejected");
  if (kind === "created" && !Object.hasOwn(result.created ?? {}, id)) {
    throw new Error("provider-rejected");
  }
  if (kind === "updated" && !Object.hasOwn(result.updated ?? {}, id)) {
    throw new Error("provider-rejected");
  }
};

export class StalwartMailForwardingAdministrator {
  private readonly client: StalwartManagementClient;

  public constructor(config: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly expectedOrigin: string;
  }) {
    this.client = new StalwartManagementClient(config);
  }

  public async inspect(): Promise<"available" | "conflict"> {
    const stage = await this.getStage();
    if (!isSelection(stage.script, disabledSelection) &&
        !isSelection(stage.script, stageSelection)) return "conflict";
    try {
      await this.findScriptId();
      return "available";
    } catch (error) {
      if (error instanceof Error && error.message === "provider-script-conflict") {
        return "conflict";
      }
      throw error;
    }
  }

  public validate(entries: readonly MailForwardingConfiguration[]): void {
    compileStalwartForwardingScript(entries);
  }

  public async apply(entries: readonly MailForwardingConfiguration[]): Promise<void> {
    const stage = await this.getStage();
    if (!isSelection(stage.script, disabledSelection) &&
        !isSelection(stage.script, stageSelection)) {
      throw new Error("provider-script-conflict");
    }
    const scriptId = await this.upsertScript(compileStalwartForwardingScript(entries));
    if (isSelection(stage.script, disabledSelection)) {
      const callId = "forwarding-stage-set";
      const response = await this.client.request([["x:MtaStageData/set", {
        update: { singleton: { script: stageSelection } },
      }, callId]], true);
      assertSet(this.client.result(
        response, callId, "x:MtaStageData/set", stalwartSetResultSchema, true,
      ), "updated", "singleton");
    }
    void scriptId;
  }

  private async getStage() {
    const callId = "forwarding-stage-get";
    const response = await this.client.request([[
      "x:MtaStageData/get", { ids: ["singleton"], properties: ["id", "script"] }, callId,
    ]]);
    const result = this.client.result(
      response, callId, "x:MtaStageData/get",
      stalwartGetResultSchema(stalwartMtaStageDataSchema),
    );
    const stage = result.list[0];
    if (!stage || result.list.length !== 1) throw new Error("provider-response");
    return stage;
  }

  private async upsertScript(contents: string): Promise<string> {
    const existingId = await this.findScriptId();
    const callId = "forwarding-script-set";
    const payload = {
      contents, description: DESCRIPTION, isActive: true, name: VEDA_FORWARDING_SCRIPT_NAME,
    };
    const argumentsValue = existingId
      ? { update: { [existingId]: payload } }
      : { create: { forwarding: payload } };
    const response = await this.client.request([[
      "x:SieveSystemScript/set", argumentsValue, callId,
    ]], true);
    const result = this.client.result(
      response, callId, "x:SieveSystemScript/set", stalwartSetResultSchema, true,
    );
    assertSet(result, existingId ? "updated" : "created", existingId ?? "forwarding");
    return existingId ?? result.created!["forwarding"]!.id;
  }

  private async findScriptId(): Promise<string | undefined> {
    const queryId = "forwarding-script-query";
    const queryResponse = await this.client.request([[
      "x:SieveSystemScript/query", { filter: { name: VEDA_FORWARDING_SCRIPT_NAME }, limit: 10 }, queryId,
    ]]);
    const query = this.client.result(
      queryResponse, queryId, "x:SieveSystemScript/query", stalwartQueryResultSchema,
    );
    if (query.total > query.ids.length) throw new Error("provider-script-conflict");
    if (!query.ids.length) return undefined;
    const getId = "forwarding-script-get";
    const response = await this.client.request([[
      "x:SieveSystemScript/get", { ids: query.ids, properties: ["id", "name", "contents"] }, getId,
    ]]);
    const found = this.client.result(
      response, getId, "x:SieveSystemScript/get",
      stalwartGetResultSchema(stalwartSystemScriptSchema),
    ).list.filter((script) => script.name === VEDA_FORWARDING_SCRIPT_NAME);
    if (found.length > 1) throw new Error("provider-script-conflict");
    if (found.length === 0 && query.ids.length >= 10) {
      throw new Error("provider-script-conflict");
    }
    const script = found[0];
    if (script && (script.description !== DESCRIPTION ||
        decodeOwnedSieveBody(script.contents) === null)) {
      throw new Error("provider-script-conflict");
    }
    return script?.id;
  }
}
