export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage = message
  ) {
    super(message);
  }
}
