export class DraftConflictError extends Error {
  public constructor() {
    super("The provider draft changed since it was last loaded.");
    this.name = "DraftConflictError";
  }
}

export class DraftHasAttachmentsError extends Error {
  public constructor() {
    super("Drafts with provider attachments cannot be replaced yet.");
    this.name = "DraftHasAttachmentsError";
  }
}

export class DraftContentTruncatedError extends Error {
  public constructor() {
    super("The complete provider draft could not be loaded safely.");
    this.name = "DraftContentTruncatedError";
  }
}

export class DraftInputError extends Error {
  public constructor() {
    super("The provider draft input is invalid.");
    this.name = "DraftInputError";
  }
}

export class DraftNotFoundError extends Error {
  public constructor() {
    super("Draft not found.");
    this.name = "DraftNotFoundError";
  }
}

export class DraftUnavailableError extends Error {
  public constructor() {
    super("Provider-backed drafts are not writable for this account.");
    this.name = "DraftUnavailableError";
  }
}
