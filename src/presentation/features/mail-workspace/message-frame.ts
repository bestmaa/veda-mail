import { MAX_RENDERABLE_RECEIVED_INLINE_IMAGES } from "@/domain/mail/inline-image";

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
export const MESSAGE_FRAME_INLINE_IMAGE_EVENT =
  "veda-mail:inline-image";
export const MAX_MESSAGE_FRAME_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGE_FRAME_INLINE_IMAGES =
  MAX_RENDERABLE_RECEIVED_INLINE_IMAGES;

export interface MessageFrameInlineImageFailures {
  readonly attachmentIds: readonly string[];
  readonly renderId: string;
}

export const messageFrameInlineImageRetryIds = (
  failures: MessageFrameInlineImageFailures,
  expectedRenderId: string,
): readonly string[] =>
  failures.renderId === expectedRenderId
    ? failures.attachmentIds
    : [];

export const settleMessageFrameInlineImageFailures = (
  previous: MessageFrameInlineImageFailures,
  renderId: string,
  attemptedIds: readonly string[],
  failedIds: ReadonlySet<string>,
): MessageFrameInlineImageFailures => {
  const attempted = new Set(attemptedIds);
  const retained =
    previous.renderId === renderId
      ? previous.attachmentIds.filter(
          (attachmentId) => !attempted.has(attachmentId),
        )
      : [];
  const attachmentIds = [...retained];
  for (const attachmentId of attemptedIds) {
    if (
      failedIds.has(attachmentId) &&
      !attachmentIds.includes(attachmentId)
    ) {
      attachmentIds.push(attachmentId);
    }
  }
  return { attachmentIds, renderId };
};

const revisionHash = (
  value: string,
  seed: number,
  reverse = false,
): string => {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    const offset = reverse ? value.length - index - 1 : index;
    hash ^= value.charCodeAt(offset);
    hash = Math.imul(hash, 0x01_00_01_93);
    hash ^= hash >>> 13;
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
};

export const createMessageFrameRenderId = (
  messageId: string,
  sanitizedHtml: string,
): string => {
  const source = `${messageId}\u0000${sanitizedHtml}`;
  return [
    source.length.toString(36),
    revisionHash(source, 0x81_1c_9d_c5),
    revisionHash(source, 0x9e_37_79_b9, true),
  ].join("-");
};

export const MESSAGE_RESIZE_SCRIPT =
  '(()=>{const heightEvent="veda-mail:message-height";' +
  'const imageEvent="veda-mail:inline-image";' +
  'const renderId=document.documentElement.dataset.vedaRenderId||"";' +
  "const urls=new Map;const revisions=new WeakMap;" +
  'const send=()=>parent.postMessage({height:Math.ceil(document.body.scrollHeight),renderId,type:heightEvent},"*");' +
  "const clear=image=>{const url=urls.get(image);if(!url)return;" +
  "URL.revokeObjectURL(url);urls.delete(image)};" +
  'addEventListener("message",event=>{const data=event.data;' +
  'if(event.source!==parent||!data||typeof data!=="object"||' +
  "data.type!==imageEvent||data.renderId!==renderId||" +
  'typeof data.attachmentId!=="string"||data.attachmentId.length>512||' +
  "!(data.blob instanceof Blob)||data.blob.type!==\"image/webp\"||" +
  "data.blob.size<1||data.blob.size>5242880)return;" +
  'for(const image of document.querySelectorAll("img[data-veda-inline-image]")){' +
  'if(image.getAttribute("data-veda-inline-image")!==data.attachmentId)continue;' +
  "clear(image);const revision=(revisions.get(image)||0)+1;" +
  "revisions.set(image,revision);const url=URL.createObjectURL(data.blob);" +
  "urls.set(image,url);const finish=failed=>{" +
  "if(revisions.get(image)!==revision)return;" +
  'if(failed){image.removeAttribute("src");clear(image)}send()};' +
  'image.addEventListener("load",()=>finish(false),{once:true});' +
  'image.addEventListener("error",()=>finish(true),{once:true});image.src=url}});' +
  'addEventListener("pagehide",()=>{for(const url of urls.values())' +
  "URL.revokeObjectURL(url);urls.clear()});" +
  'new ResizeObserver(send).observe(document.body);addEventListener("load",send);send()})();';

export const MESSAGE_RESIZE_SCRIPT_HASH =
  "5Y5olpdfb9HF2ncx6UGgnO2gTM7kh1s0vsUA1qpyKYQ=";
export const MESSAGE_FRAME_STYLE_HASH =
  "7gSOBhlM+GuUdVmICMTxZKqK2m/EgD0p3SqYCLlMl7Y=";

const escapeHtmlAttribute = (value: string): string =>
  value
    .slice(0, 512)
    .replace(
      /[&"<>]/gu,
      (character) =>
        ({
          '"': "&quot;",
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
        })[character] ?? "",
    );

export const buildSanitizedMessageDocument = (
  sanitizedHtml: string,
  renderId = "",
): string => `<!doctype html>
<html lang="en" data-veda-render-id="${escapeHtmlAttribute(renderId)}">
<head>
<meta charset="utf-8">
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; img-src blob:; style-src 'sha256-${MESSAGE_FRAME_STYLE_HASH}'; style-src-attr 'none'; script-src 'sha256-${MESSAGE_RESIZE_SCRIPT_HASH}'"
>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${MESSAGE_FRAME_STYLES}</style>
</head>
<body>${sanitizedHtml}<script>${MESSAGE_RESIZE_SCRIPT}</script></body>
</html>`;

interface MessageFrameEventData {
  readonly height: number;
  readonly renderId: string;
  readonly type: typeof MESSAGE_FRAME_EVENT;
}

export const isMessageFrameEventData = (
  value: unknown,
  expectedRenderId?: string,
): value is MessageFrameEventData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MessageFrameEventData>;
  return (
    candidate.type === MESSAGE_FRAME_EVENT &&
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.height) &&
    typeof candidate.renderId === "string" &&
    candidate.renderId.length <= 128 &&
    (expectedRenderId === undefined ||
      candidate.renderId === expectedRenderId)
  );
};
