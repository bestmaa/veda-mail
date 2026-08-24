import "server-only";

import type {
  MailForwardingConfiguration,
  MailForwardingSnapshot,
} from "@/domain/admin/mail-forwarding";
import { StalwartMailForwardingAdministrator } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-forwarding-administrator";
import { StalwartManagementRequestError } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";
import { installationStore } from "@/server/installation/installation.store";
import type { MailForwardingLedger } from "@/server/mail-forwarding/mail-forwarding.schema";
import { mailForwardingStore } from "@/server/mail-forwarding/mail-forwarding.store";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailForwardingMutationQueue?: Promise<void>;
};
globalState.__vedaMailForwardingMutationQueue ??= Promise.resolve();

const resolution = async () => {
  const installation = await installationStore.get();
  if (!installation) throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  if (installation.mailProfile.providerId !== "stalwart-jmap") {
    return { allowedDomains: installation.mailProfile.allowedDomains, kind: "unsupported" as const };
  }
  const apiKey = process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"]?.trim();
  const origin = process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"]?.trim();
  const baseUrl = installation.mailProfile.config["baseUrl"];
  if (!apiKey || !origin) {
    return { allowedDomains: installation.mailProfile.allowedDomains, kind: "unconfigured" as const };
  }
  if (!baseUrl) throw new ApiError("Forwarding is not configured correctly.", "MAIL_FORWARDING_CONFIGURATION", 503);
  try {
    const expected = new URL(origin);
    const provider = new URL(baseUrl);
    if (expected.protocol !== "https:" || expected.origin !== provider.origin ||
        expected.username || expected.password || expected.search || expected.hash ||
        (expected.pathname !== "/" && expected.pathname !== "")) throw new Error();
    return {
      administrator: new StalwartMailForwardingAdministrator({
        apiKey, baseUrl, expectedOrigin: expected.origin,
      }),
      allowedDomains: installation.mailProfile.allowedDomains,
      kind: "available" as const,
    };
  } catch {
    throw new ApiError("Forwarding is not configured correctly.", "MAIL_FORWARDING_CONFIGURATION", 503);
  }
};

const providerFailure = (error: unknown): never => {
  if (error instanceof ApiError) throw error;
  if (error instanceof Error && error.message === "provider-script-conflict") {
    throw new ApiError(
      "Stalwart already uses a different DATA-stage Sieve script. Veda Mail did not overwrite it.",
      "MAIL_FORWARDING_PROVIDER_CONFLICT", 409,
    );
  }
  if (error instanceof StalwartManagementRequestError) {
    const auth = error.code === "auth";
    throw new ApiError(
      auth ? "Stalwart rejected the forwarding management credential." :
        "Stalwart could not apply the forwarding configuration.",
      auth ? "MAIL_FORWARDING_PROVIDER_AUTH" : "MAIL_FORWARDING_PROVIDER_UNAVAILABLE",
      503,
    );
  }
  throw new ApiError(
    "Stalwart could not apply the forwarding configuration.",
    "MAIL_FORWARDING_PROVIDER_UNAVAILABLE", 503,
  );
};

const reason = (kind: "conflict" | "unconfigured" | "unsupported") => ({
  conflict: "Stalwart already has a different DATA-stage Sieve script; Veda Mail will not overwrite it.",
  unconfigured: "Configure the scoped Stalwart management credential and exact HTTPS origin.",
  unsupported: "The active mail provider does not support admin-controlled server-side forwarding.",
})[kind];

export const getMailForwardingSnapshot = async (
  sourceEmail: string,
): Promise<MailForwardingSnapshot> => {
  const [provider, ledger] = await Promise.all([resolution(), mailForwardingStore.get()]);
  const configuration = ledger.entries.find((entry) =>
    entry.sourceEmail.toLowerCase() === sourceEmail.toLowerCase()) ?? null;
  if (provider.kind !== "available") {
    return { availability: provider.kind, configuration, reason: reason(provider.kind), revision: ledger.revision };
  }
  try {
    const availability = await provider.administrator.inspect();
    return {
      availability, configuration,
      reason: availability === "conflict" ? reason("conflict") : null,
      revision: ledger.revision,
    };
  } catch (error) { return providerFailure(error); }
};

export const getManagedMailForwarding = async (sourceEmail: string) => {
  const ledger = await mailForwardingStore.get();
  return {
    configuration: ledger.entries.find((entry) =>
      entry.sourceEmail.toLowerCase() === sourceEmail.toLowerCase()) ?? null,
    revision: ledger.revision,
  };
};

const nextLedger = (
  current: MailForwardingLedger,
  entries: readonly MailForwardingConfiguration[],
): MailForwardingLedger => ({
  entries: entries.map((entry) => ({
    ...entry, sourceAddresses: [...entry.sourceAddresses],
  })), revision: current.revision + 1,
  updatedAt: new Date().toISOString(), version: 1,
});

const reconcile = async (
  administrator: StalwartMailForwardingAdministrator,
): Promise<MailForwardingLedger> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await mailForwardingStore.get();
    await administrator.apply(current.entries);
    const active = nextLedger(current, current.entries.map((entry) => ({
      ...entry, status: "active" as const, updatedAt: new Date().toISOString(),
    })));
    if (await mailForwardingStore.put(current.revision, active)) return active;
  }
  throw new ApiError("Forwarding changed too frequently. Retry.", "MAIL_FORWARDING_CONFLICT", 409);
};

const mutation = <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailForwardingMutationQueue!.then(task, task);
  globalState.__vedaMailForwardingMutationQueue = result.then(() => undefined, () => undefined);
  return result;
};

export const setMailForwarding = (
  sourceEmail: string,
  sourceAddresses: readonly string[],
  destinationEmail: string,
  expectedRevision: number,
) => mutation(async () => {
  const provider = await resolution();
  if (provider.kind !== "available") {
    throw new ApiError(reason(provider.kind), "MAIL_FORWARDING_UNAVAILABLE", 409);
  }
  const destinationDomain = destinationEmail.slice(destinationEmail.lastIndexOf("@") + 1).toLowerCase();
  const destinationKey = destinationEmail.toLowerCase();
  if (sourceAddresses.some((address) => address.toLowerCase() === destinationKey) ||
      provider.allowedDomains.some((domain) => domain.toLowerCase() === destinationDomain)) {
    throw new ApiError(
      "Choose an external destination outside Veda Mail's managed domains.",
      "MAIL_FORWARDING_LOOP_RISK", 400,
    );
  }
  const current = await mailForwardingStore.get();
  if (current.revision !== expectedRevision) {
    throw new ApiError("Forwarding changed. Review and retry.", "MAIL_FORWARDING_CONFLICT", 409);
  }
  const now = new Date().toISOString();
  const entry: MailForwardingConfiguration = {
    destinationEmail, keepLocalCopy: true, sourceAddresses,
    sourceEmail, status: "applying", updatedAt: now,
  };
  const desiredEntries = [
    ...current.entries.filter((item) => item.sourceEmail.toLowerCase() !== sourceEmail.toLowerCase()), entry,
  ];
  try { provider.administrator.validate(desiredEntries); }
  catch (error) {
    if (error instanceof RangeError) {
      throw new ApiError(
        "The forwarding program reached its safe capacity.",
        "MAIL_FORWARDING_CAPACITY", 409,
      );
    }
    throw error;
  }
  const desired = nextLedger(current, desiredEntries);
  if (!(await mailForwardingStore.put(current.revision, desired))) {
    throw new ApiError("Forwarding changed. Review and retry.", "MAIL_FORWARDING_CONFLICT", 409);
  }
  try { return await reconcile(provider.administrator); }
  catch (error) {
    const latest = await mailForwardingStore.get();
    const failed = nextLedger(latest, latest.entries.map((item) =>
      item.sourceEmail.toLowerCase() === sourceEmail.toLowerCase() &&
        item.destinationEmail === entry.destinationEmail &&
        item.status === "applying" && item.updatedAt === entry.updatedAt
        ? { ...item, status: "error" as const, updatedAt: new Date().toISOString() } : item,
    ));
    if (latest.revision === desired.revision) {
      await mailForwardingStore.put(latest.revision, failed).catch(() => false);
    }
    return providerFailure(error);
  }
});

export const removeMailForwarding = (
  sourceEmail: string,
  expectedRevision: number,
) => mutation(async () => {
  const provider = await resolution();
  if (provider.kind !== "available") {
    throw new ApiError(reason(provider.kind), "MAIL_FORWARDING_UNAVAILABLE", 409);
  }
  const current = await mailForwardingStore.get();
  if (current.revision !== expectedRevision) {
    throw new ApiError("Forwarding changed. Review and retry.", "MAIL_FORWARDING_CONFLICT", 409);
  }
  const desired = nextLedger(current, current.entries.filter((entry) =>
    entry.sourceEmail.toLowerCase() !== sourceEmail.toLowerCase(),
  ));
  if (!(await mailForwardingStore.put(current.revision, desired))) {
    throw new ApiError("Forwarding changed. Review and retry.", "MAIL_FORWARDING_CONFLICT", 409);
  }
  try { return await reconcile(provider.administrator); }
  catch (error) {
    const removed = current.entries.find((entry) =>
      entry.sourceEmail.toLowerCase() === sourceEmail.toLowerCase(),
    );
    if (removed) {
      const latest = await mailForwardingStore.get();
      const newer = latest.entries.some((entry) =>
        entry.sourceEmail.toLowerCase() === sourceEmail.toLowerCase());
      const restored = nextLedger(latest, [...latest.entries, {
        ...removed, status: "error", updatedAt: new Date().toISOString(),
      }]);
      if (!newer && latest.revision === desired.revision) {
        await mailForwardingStore.put(latest.revision, restored).catch(() => false);
      }
    }
    return providerFailure(error);
  }
});
