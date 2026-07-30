import type {
  EmailSignature,
  EmailSignatureBook,
  EmailSignaturePutOperation,
} from "@/domain/member/email-signature";

const updateSignature = (
  signature: EmailSignature,
  operation: Extract<
    EmailSignaturePutOperation,
    { readonly operation: "update" }
  >,
): EmailSignature => {
  if (signature.id !== operation.signatureId) return signature;
  if (operation.content.mode === "plain") {
    const { htmlBody: _discarded, ...plainSignature } = signature;
    void _discarded;
    return {
      ...plainSignature,
      body: operation.content.body,
      name: operation.name,
    };
  }
  return {
    ...signature,
    htmlBody: operation.content.htmlBody,
    name: operation.name,
  };
};

export const optimisticEmailSignatureBook = (
  book: EmailSignatureBook,
  operation: EmailSignaturePutOperation,
): EmailSignatureBook => {
  if (operation.expectedRevision !== book.revision) return book;
  if (operation.operation === "create") return book;
  if (operation.operation === "update") {
    return {
      ...book,
      signatures: book.signatures.map((signature) =>
        updateSignature(signature, operation),
      ),
    };
  }
  if (operation.operation === "set-defaults") {
    return {
      ...book,
      defaults: {
        newMessageId: operation.newMessageId,
        replyForwardId: operation.replyForwardId,
      },
    };
  }
  const signatures = book.signatures.filter(
    ({ id }) => id !== operation.signatureId,
  );
  return {
    ...book,
    defaults: {
      newMessageId:
        book.defaults.newMessageId === operation.signatureId
          ? null
          : book.defaults.newMessageId,
      replyForwardId:
        book.defaults.replyForwardId === operation.signatureId
          ? null
          : book.defaults.replyForwardId,
    },
    signatures,
  };
};
