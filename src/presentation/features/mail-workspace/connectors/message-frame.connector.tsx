"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildSanitizedMessageDocument,
  isMessageFrameEventData,
} from "@/presentation/features/mail-workspace/message-frame";

const INITIAL_HEIGHT = 160;
const MIN_HEIGHT = 48;
const MAX_HEIGHT = 100_000;

interface FrameSize {
  readonly height: number;
  readonly source: string;
}

const boundedHeight = (height: number): number =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)));

export const MessageFrameConnector = ({
  sanitizedHtml,
}: {
  readonly sanitizedHtml: string;
}) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameSize, setFrameSize] = useState<FrameSize>({
    height: INITIAL_HEIGHT,
    source: sanitizedHtml,
  });
  const srcDoc = useMemo(
    () => buildSanitizedMessageDocument(sanitizedHtml),
    [sanitizedHtml],
  );

  useEffect(() => {
    const receiveHeight = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isMessageFrameEventData(event.data)
      ) {
        return;
      }
      setFrameSize({
        height: boundedHeight(event.data.height),
        source: sanitizedHtml,
      });
    };
    window.addEventListener("message", receiveHeight);
    return () => window.removeEventListener("message", receiveHeight);
  }, [sanitizedHtml]);

  const height =
    frameSize.source === sanitizedHtml
      ? frameSize.height
      : INITIAL_HEIGHT;
  return (
    <iframe
      className="block w-full border-0"
      ref={frameRef}
      sandbox="allow-scripts"
      scrolling="no"
      srcDoc={srcDoc}
      style={{ height: `${height}px` }}
      title="Email content"
    />
  );
};
