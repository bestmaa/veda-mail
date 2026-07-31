interface Address {
  readonly email: string;
  readonly name?: string | null | undefined;
}

const grouped = (addresses: readonly Address[]) =>
  addresses.length > 0 ? [[{ addresses, name: null }]] : [];

const leaf = (partId: string, type: "text/html" | "text/plain") => ({
  headers: [{ name: "Content-Type", value: `${type}; charset=utf-8` }],
  partId,
  type,
});

export const safeStalwartDraftShape = (input: {
  readonly bcc?: readonly Address[];
  readonly cc?: readonly Address[];
  readonly from?: readonly Address[];
  readonly htmlPartId?: string;
  readonly messageId?: string;
  readonly textPartId?: string;
  readonly to?: readonly Address[];
} = {}) => {
  const bcc = input.bcc ?? [];
  const cc = input.cc ?? [];
  const from = input.from ?? [
    { email: "member@example.com", name: "Member" },
  ];
  const to = input.to ?? [];
  const text = leaf(input.textPartId ?? "text", "text/plain");
  const html = input.htmlPartId
    ? leaf(input.htmlPartId, "text/html")
    : undefined;
  return {
    bodyStructure: html
      ? {
          headers: [
            {
              name: "Content-Type",
              value: 'multipart/alternative; boundary="safe-boundary"',
            },
          ],
          subParts: [text, html],
          type: "multipart/alternative",
        }
      : text,
    headers: [
      { name: "From", value: "member@example.com" },
      { name: "Message-ID", value: input.messageId ?? "draft@example.com" },
      {
        name: "Content-Type",
        value: html
          ? 'multipart/alternative; boundary="safe-boundary"'
          : "text/plain; charset=utf-8",
      },
      ...(to.length > 0 ? [{ name: "To", value: "recipients" }] : []),
      ...(cc.length > 0 ? [{ name: "Cc", value: "recipients" }] : []),
      ...(bcc.length > 0 ? [{ name: "Bcc", value: "recipients" }] : []),
    ],
    "header:Bcc:asGroupedAddresses:all": grouped(bcc),
    "header:Cc:asGroupedAddresses:all": grouped(cc),
    "header:From:asGroupedAddresses:all": grouped(from),
    "header:To:asGroupedAddresses:all": grouped(to),
    htmlBody: html ? [html] : [],
    textBody: [text],
  };
};
