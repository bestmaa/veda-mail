"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { SendReceipt } from "@/domain/mail/mail";
import { parseDeliveryNoticeSnapshot } from "@/presentation/features/mail-workspace/delivery-notice-snapshot";
import type { DeliveryNoticeViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import {
  applyDeliveryReceipt,
  deliveryNoticeId,
  dismissDeliveryNotice,
  mergeDeliveryNotices,
  restoreDeliveryNotice,
  type DeliveryNotice,
} from "@/presentation/features/mail-workspace/partial-delivery-notice";
import { deliveryNoticeApi } from "@/transport/client/delivery-notice-api";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

const DISMISS_FAILURE =
  "This delivery notice could not be dismissed. Try again.";

export const usePartialDeliveryNotice = (
  onRefresh: () => void,
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const [queue, setQueue] = useState<readonly DeliveryNotice[]>([]);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const lifecycle = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const dismissedIds = useRef(new Set<string>());
  const dismissInFlight = useRef(false);

  useLayoutEffect(() => {
    setQueue([]);
    setDismissError(null);
    setIsDismissing(false);
    if (!sessionScope) return;
    const generation = ++lifecycle.current;
    const controller = new AbortController();
    const activeRequests = requests.current;
    const activeDismissedIds = dismissedIds.current;
    activeRequests.add(controller);
    void deliveryNoticeApi
      .list(sessionScope, controller.signal)
      .then((snapshot) => {
        if (
          controller.signal.aborted ||
          generation !== lifecycle.current
        ) {
          return;
        }
        const hydrated = parseDeliveryNoticeSnapshot(snapshot).filter(
          ({ deliveryNoticeId: noticeId }) =>
            !noticeId || !activeDismissedIds.has(noticeId),
        );
        setQueue((current) => mergeDeliveryNotices(hydrated, current));
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generation !== lifecycle.current
        ) {
          return;
        }
        if (handleSessionFailure(error)) return;
        setQueue((current) =>
          mergeDeliveryNotices(current, [{ kind: "overflow" }]),
        );
      })
      .finally(() => activeRequests.delete(controller));
    return () => {
      lifecycle.current += 1;
      for (const request of activeRequests) request.abort();
      activeRequests.clear();
      activeDismissedIds.clear();
      dismissInFlight.current = false;
    };
  }, [handleSessionFailure, sessionScope]);

  const dismiss = useCallback(() => {
    if (!sessionScope || dismissInFlight.current) return;
    const current = queue[0];
    if (!current) return;
    setDismissError(null);
    setQueue((notices) => dismissDeliveryNotice(notices, current));
    const noticeId = current.deliveryNoticeId;
    if (!noticeId) return;

    dismissInFlight.current = true;
    dismissedIds.current.add(noticeId);
    setIsDismissing(true);
    const generation = lifecycle.current;
    const controller = new AbortController();
    requests.current.add(controller);
    void deliveryNoticeApi
      .dismiss(noticeId, sessionScope, controller.signal)
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generation !== lifecycle.current
        ) {
          return;
        }
        if (handleSessionFailure(error)) return;
        dismissedIds.current.delete(noticeId);
        setQueue((notices) => restoreDeliveryNotice(notices, current));
        setDismissError(DISMISS_FAILURE);
      })
      .finally(() => {
        requests.current.delete(controller);
        if (
          !controller.signal.aborted &&
          generation === lifecycle.current
        ) {
          dismissInFlight.current = false;
          setIsDismissing(false);
        }
      });
  }, [handleSessionFailure, queue, sessionScope]);

  const onSent = useCallback(
    (receipt: SendReceipt, submittedEmails: readonly string[]) => {
      const noticeId = deliveryNoticeId(receipt.deliveryNoticeId);
      setQueue((current) =>
        noticeId && dismissedIds.current.has(noticeId)
          ? current
          : applyDeliveryReceipt(current, receipt, submittedEmails),
      );
      onRefresh();
    },
    [onRefresh],
  );
  const current = queue[0];
  const notice: DeliveryNoticeViewModel | null = current
    ? {
        ...current,
        dismissError,
        isDismissing,
        onDismiss: dismiss,
        pendingCount: queue.length,
      }
    : null;
  return { notice, onSent };
};
