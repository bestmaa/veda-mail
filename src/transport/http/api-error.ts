export const API_ERROR_CODE_HEADER = "x-veda-api-error-code";

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
