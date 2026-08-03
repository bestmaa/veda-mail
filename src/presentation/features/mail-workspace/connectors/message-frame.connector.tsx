"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { id } from "@/domain/shared/brand";
import {
  buildSanitizedMessageDocument,
  createMessageFrameRenderId,
  isMessageFrameEventData,
  MAX_MESSAGE_FRAME_INLINE_IMAGES,
  messageFrameInlineImageRetryIds,
  MESSAGE_FRAME_INLINE_IMAGE_EVENT,
  settleMessageFrameInlineImageFailures,
  type MessageFrameInlineImageFailures,
} from "@/presentation/features/mail-workspace/message-frame";
import { InlineImageRetryControlView } from "@/presentation/features/mail-workspace/ui/inline-image-retry-control.view";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { attachmentApi } from "@/transport/client/attachment-api";
import { createInlineImageHref } from "@/transport/client/inline-image-api";
const INITIAL_HEIGHT = 160;
const MIN_HEIGHT = 48;
const MAX_HEIGHT = 100_000;
const INLINE_IMAGE_ATTRIBUTE = "data-veda-inline-image";
const INLINE_IMAGE_CONCURRENCY = 2;
interface FrameSize { readonly height: number; readonly source: string }
interface InlineImageRetryBatch {
  readonly attachmentIds: readonly string[]; readonly renderId: string;
}
const EMPTY_INLINE_IMAGE_FAILURES: MessageFrameInlineImageFailures =
  { attachmentIds: [], renderId: "" };
const boundedHeight = (height: number): number =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)));
interface MessageFrameConnectorProps {
  readonly collapseQuotes?: boolean;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly messageId: string;
  readonly sanitizedHtml: string;
  readonly sessionScope: string;
}
interface MessageFrameRenderProps extends MessageFrameConnectorProps {
  readonly frameSource: string;
}

const MessageFrameRender = ({
  collapseQuotes = false,
  frameSource,
  handleSessionFailure,
  messageId,
  sanitizedHtml,
  sessionScope,
}: MessageFrameRenderProps) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const renderId = useMemo(
    () => createMessageFrameRenderId(
      messageId,
      `${collapseQuotes ? "collapsed" : "expanded"}\u0000${sanitizedHtml}`,
    ),
    [collapseQuotes, messageId, sanitizedHtml],
  );
  const [frameSize, setFrameSize] = useState<FrameSize>({
    height: INITIAL_HEIGHT,
    source: frameSource,
  });
  const [loadedRenderId, setLoadedRenderId] = useState("");
  const [inlineImageFailures, setInlineImageFailures] =
    useState<MessageFrameInlineImageFailures>(EMPTY_INLINE_IMAGE_FAILURES);
  const [inlineImageRequestRevision, setInlineImageRequestRevision] = useState(0);
  const [retryingRenderId, setRetryingRenderId] = useState("");
  const retryBatchRef = useRef<InlineImageRetryBatch | null>(null);
  const srcDoc = useMemo(
    () => buildSanitizedMessageDocument(sanitizedHtml, renderId, collapseQuotes),
    [collapseQuotes, renderId, sanitizedHtml],
  );
  useEffect(() => {
    const receiveHeight = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isMessageFrameEventData(event.data, renderId)
      ) {
        return;
      }
      setFrameSize({
        height: boundedHeight(event.data.height),
        source: frameSource,
      });
    };
    window.addEventListener("message", receiveHeight);
    return () => window.removeEventListener("message", receiveHeight);
  }, [frameSource, renderId]);
  useEffect(() => {
    if (loadedRenderId !== renderId) return;
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) return;
    const parsed = new DOMParser().parseFromString(sanitizedHtml, "text/html");
    const attachmentIds = Array.from(
      parsed.querySelectorAll(`img[${INLINE_IMAGE_ATTRIBUTE}]`),
    )
      .map((image) => image.getAttribute(INLINE_IMAGE_ATTRIBUTE)?.trim() ?? "")
      .filter((attachmentId) => attachmentId.length > 0 && attachmentId.length <= 512)
      .filter(
        (attachmentId, index, values) =>
          values.indexOf(attachmentId) === index,
      )
      .slice(0, MAX_MESSAGE_FRAME_INLINE_IMAGES);
    const queuedRetry = retryBatchRef.current;
    retryBatchRef.current = null;
    const isRetry = queuedRetry !== null && queuedRetry.renderId === renderId;
    const allowedIds = new Set(attachmentIds);
    const requestedIds = isRetry
      ? queuedRetry.attachmentIds.filter((attachmentId) =>
          allowedIds.has(attachmentId),
        )
      : attachmentIds;
    const attemptedIds = isRetry ? queuedRetry.attachmentIds : requestedIds;
    if (requestedIds.length === 0) {
      if (isRetry) {
        setInlineImageFailures((previous) =>
          settleMessageFrameInlineImageFailures(
            previous,
            renderId,
            attemptedIds,
            new Set(),
          ),
        );
        setRetryingRenderId((current) => current === renderId ? "" : current);
      }
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    let cursor = 0;
    const failedIds = new Set<string>();
    const loadNext = async (): Promise<void> => {
      while (!cancelled && cursor < requestedIds.length) {
        const attachmentId = requestedIds[cursor];
        cursor += 1;
        if (!attachmentId) continue;
        try {
          const blob = await attachmentApi.fetchInlineImage(
            createInlineImageHref(
              id.message(messageId),
              id.attachment(attachmentId),
            ),
            sessionScope,
            controller.signal,
          );
          if (cancelled) return;
          targetWindow.postMessage(
            {
              attachmentId,
              blob,
              renderId,
              type: MESSAGE_FRAME_INLINE_IMAGE_EVENT,
            },
            "*",
          );
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          if (handleSessionFailure(error)) {
            cancelled = true;
            controller.abort();
            return;
          }
          failedIds.add(attachmentId);
        }
      }
    };
    const workers = Array.from(
      {
        length: Math.min(
          INLINE_IMAGE_CONCURRENCY,
          requestedIds.length,
        ),
      },
      () => loadNext(),
    );
    void Promise.all(workers).then(() => {
      if (cancelled) return;
      setInlineImageFailures((previous) =>
        settleMessageFrameInlineImageFailures(
          previous,
          renderId,
          attemptedIds,
          failedIds,
        ),
      );
      if (isRetry) {
        setRetryingRenderId((current) => current === renderId ? "" : current);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    inlineImageRequestRevision,
    handleSessionFailure,
    loadedRenderId,
    messageId,
    renderId,
    sanitizedHtml,
    sessionScope,
  ]);

  const height =
    frameSize.source === frameSource ? frameSize.height : INITIAL_HEIGHT;
  const retryIds = messageFrameInlineImageRetryIds(
    inlineImageFailures,
    renderId,
  );
  const isRetrying = retryingRenderId === renderId;
  const retryFailedInlineImages = (): void => {
    if (isRetrying || retryIds.length === 0) return;
    retryBatchRef.current = {
      attachmentIds: [...retryIds],
      renderId,
    };
    setRetryingRenderId(renderId);
    setInlineImageRequestRevision((revision) => revision + 1);
  };
  return (
    <>
      <iframe
        className="block w-full border-0"
        onLoad={() => setLoadedRenderId(renderId)}
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
        scrolling="no"
        srcDoc={srcDoc}
        style={{ height: `${height}px` }}
        title="Email content"
      />
      <InlineImageRetryControlView
        failedCount={retryIds.length}
        isRetrying={isRetrying}
        onRetry={retryFailedInlineImages}
      />
    </>
  );
};

export const MessageFrameConnector = (props: MessageFrameConnectorProps) => {
  const frameSource = `${props.messageId}\u0000${props.collapseQuotes ? "collapsed" : "expanded"}\u0000${props.sanitizedHtml}`;
  return <MessageFrameRender
    {...props} frameSource={frameSource} key={frameSource}
  />;
};
