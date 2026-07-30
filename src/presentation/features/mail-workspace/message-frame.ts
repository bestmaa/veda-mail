export const MESSAGE_FRAME_STYLES = `
:root{color-scheme:light}
html{overflow:hidden}
body{
  color:#334155;
  display:flow-root;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
  font-size:15px;
  line-height:1.75;
  margin:0;
  overflow-wrap:anywhere;
}
a{color:#3730a3;text-decoration:underline;text-underline-offset:3px}
h1,h2,h3,h4,h5,h6{color:#0f172a;line-height:1.3;margin:0 0 .65em}
p,blockquote,pre,table,ul,ol{margin:0 0 1em}
p:last-child,blockquote:last-child,pre:last-child,table:last-child,
ul:last-child,ol:last-child{margin-bottom:0}
ul,ol{padding-inline-start:1.6em}
li+li{margin-top:.3em}
blockquote{border-inline-start:3px solid #cbd5e1;color:#475569;padding-inline-start:1em}
pre{font:inherit;white-space:pre-wrap}
code,pre code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
table{border-collapse:collapse;max-width:100%}
td,th{padding:.25em .45em;text-align:start;vertical-align:top}
img{height:auto;max-width:100%}
`.trim();

export const MESSAGE_FRAME_EVENT = "veda-mail:message-height";

export const MESSAGE_RESIZE_SCRIPT =
  '(()=>{const send=()=>parent.postMessage({height:Math.ceil(document.body.scrollHeight),type:"veda-mail:message-height"},"*");new ResizeObserver(send).observe(document.body);addEventListener("load",send);send()})();';

export const MESSAGE_RESIZE_SCRIPT_HASH =
  "po6rY2z0eTgjMb/acZdOGxGy/BTpP0qaIHeVZH1/V9k=";
export const MESSAGE_FRAME_STYLE_HASH =
  "7gSOBhlM+GuUdVmICMTxZKqK2m/EgD0p3SqYCLlMl7Y=";

export const buildSanitizedMessageDocument = (
  sanitizedHtml: string,
): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'sha256-${MESSAGE_FRAME_STYLE_HASH}'; style-src-attr 'none'; script-src 'sha256-${MESSAGE_RESIZE_SCRIPT_HASH}'"
>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${MESSAGE_FRAME_STYLES}</style>
</head>
<body>${sanitizedHtml}<script>${MESSAGE_RESIZE_SCRIPT}</script></body>
</html>`;

interface MessageFrameEventData {
  readonly height: number;
  readonly type: typeof MESSAGE_FRAME_EVENT;
}

export const isMessageFrameEventData = (
  value: unknown,
): value is MessageFrameEventData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MessageFrameEventData>;
  return (
    candidate.type === MESSAGE_FRAME_EVENT &&
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.height)
  );
};
