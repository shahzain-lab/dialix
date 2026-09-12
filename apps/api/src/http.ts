export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function httpError(statusCode: number, message: string, details?: unknown) {
  return new HttpError(message, statusCode, details);
}
