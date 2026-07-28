import "server-only";

import sanitizeHtml from "sanitize-html";

const allowedTags = [
  "a",
  "address",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;

const safeLinkHref = (value?: string): string | null => {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? candidate
      : null;
  } catch {
    return null;
  }
};

export const sanitizeMailHtml = (value: string): string =>
  sanitizeHtml(value, {
    allowProtocolRelative: false,
    allowedAttributes: {
      a: ["href", "rel", "target", "title"],
      blockquote: ["cite"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedTags: [...allowedTags],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attributes) => {
        const href = safeLinkHref(attributes["href"]);
        return {
          attribs: href
            ? {
                href,
                rel: "noopener noreferrer",
                target: "_blank",
                ...(attributes["title"]
                  ? { title: attributes["title"] }
                  : {}),
              }
            : attributes["title"]
              ? { title: attributes["title"] }
              : {},
          tagName,
        };
      },
    },
  });
