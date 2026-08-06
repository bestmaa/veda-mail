import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type { ProviderId } from "@/domain/shared/brand";
import { observeProviderOperation } from "@/server/observability/metrics";
import { currentRequestId } from "@/server/observability/request-log";
import {
  logWarn,
  safeErrorType,
} from "@/server/observability/structured-log";

type GatewayMethod = (...arguments_: readonly unknown[]) => Promise<unknown>;

export const observeMailGateway = (
  gateway: MailGateway,
  providerId: ProviderId,
): MailGateway => {
  const wrappers = new Map<PropertyKey, GatewayMethod>();
  return new Proxy(gateway, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const existing = wrappers.get(property);
      if (existing) return existing;
      const observed: GatewayMethod = async (...arguments_) => {
        const startedAt = performance.now();
        try {
          const result = await Reflect.apply(
            value as GatewayMethod,
            target,
            arguments_,
          );
          observeProviderOperation(
            providerId,
            property,
            performance.now() - startedAt,
            "success",
          );
          return result;
        } catch (error) {
          const durationMs = performance.now() - startedAt;
          const requestId = await currentRequestId();
          observeProviderOperation(providerId, property, durationMs, "error");
          logWarn("provider.operation_failed", {
            durationMs,
            errorType: safeErrorType(error),
            operation: String(property),
            outcome: "error",
            providerId,
            ...(requestId ? { requestId } : {}),
          });
          throw error;
        }
      };
      wrappers.set(property, observed);
      return observed;
    },
  });
};
