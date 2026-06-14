export type DaisyTrackerErrorKind = "configuration" | "delivery" | "github" | "internal";

export interface DaisyTrackerErrorOptions {
  cause?: unknown;
  kind: DaisyTrackerErrorKind;
  retryable?: boolean;
}

export class DaisyTrackerError extends Error {
  readonly kind: DaisyTrackerErrorKind;
  readonly retryable: boolean;

  constructor(message: string, options: DaisyTrackerErrorOptions) {
    super(message);
    this.name = "DaisyTrackerError";
    this.kind = options.kind;
    this.retryable = Boolean(options.retryable);

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isDaisyTrackerError(error: unknown): error is DaisyTrackerError {
  return error instanceof DaisyTrackerError;
}

export function shouldWarnOnly(error: unknown): boolean {
  return isDaisyTrackerError(error) && (error.kind === "delivery" || error.kind === "github");
}

export function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = redactWebhookUrl(value);

  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("***");
    }
  }

  redacted = redacted.replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1***");
  redacted = redacted.replace(/(bearer\s+)[a-z0-9_.-]+/gi, "$1***");

  return redacted;
}

export function redactWebhookUrl(value: string): string {
  return value.replace(/(\/api\/webhooks\/\d+\/)[^/?\s"']+/gi, "$1***");
}
