export class OutgoingMessageSizeError extends Error {
  public constructor() {
    super(
      "The composed message exceeds the verified provider limit. " +
        "Reduce the message body or attachments and try again.",
    );
    this.name = "OutgoingMessageSizeError";
  }
}

export class MessageDeliveryRejectedError extends Error {
  public constructor() {
    super("The mail provider rejected every submitted recipient.");
    this.name = "MessageDeliveryRejectedError";
  }
}
