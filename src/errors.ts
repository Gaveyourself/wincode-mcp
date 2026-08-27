export class WinCodeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WinCodeError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
