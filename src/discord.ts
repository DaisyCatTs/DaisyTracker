import { validateDiscordWebhookPayload } from "./discord-limits";
import { DaisyTrackerError, redactSecrets, redactWebhookUrl } from "./errors";
import type { DiscordWebhookPayload } from "./types";

interface SendOptions {
  fetch?: typeof fetch;
  maxAttempts?: number;
  redactValues?: string[];
  sleep?: (milliseconds: number) => Promise<void>;
  threadId?: string;
  timeoutMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_DELAY_MS = 10_000;

export async function sendDiscordPayloads(
  webhookUrl: string,
  payloads: DiscordWebhookPayload[],
  options: SendOptions = {},
): Promise<void> {
  validateWebhookUrl(webhookUrl);

  for (const payload of payloads) {
    validateDiscordWebhookPayload(payload);
    await sendWithRetry(webhookUrl, payload, options);
  }
}

async function sendWithRetry(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options: SendOptions,
): Promise<void> {
  const fetchImpl = options.fetch || globalThis.fetch;
  const sleep = options.sleep || defaultSleep;
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = webhookExecuteUrl(webhookUrl, options.threadId);
  const redactionValues = [...(options.redactValues || []), webhookToken(webhookUrl)];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "DaisyCatTs-DaisyTracker",
          },
          method: "POST",
        },
        timeoutMs,
      );
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(fallbackRetryDelay(attempt));
        continue;
      }

      throw new DaisyTrackerError(
        `Discord webhook request failed for ${redactWebhookUrl(webhookUrl)}: ${redactSecrets(
          error instanceof Error ? error.message : String(error),
          redactionValues,
        )}`,
        { cause: error, kind: "delivery", retryable: true },
      );
    }

    if (response.ok) {
      return;
    }

    if (isConfigurationError(response.status)) {
      throw new DaisyTrackerError(
        await webhookErrorMessage(webhookUrl, response, redactionValues),
        {
          kind: "configuration",
        },
      );
    }

    if (attempt < maxAttempts && shouldRetry(response.status)) {
      await sleep(await retryDelay(response, attempt));
      continue;
    }

    throw new DaisyTrackerError(await webhookErrorMessage(webhookUrl, response, redactionValues), {
      kind: "delivery",
      retryable: shouldRetry(response.status),
    });
  }
}

function validateWebhookUrl(webhookUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new DaisyTrackerError("Discord webhook URL is not a valid URL.", {
      kind: "configuration",
    });
  }

  if (parsed.protocol !== "https:") {
    throw new DaisyTrackerError("Discord webhook URL must use https.", {
      kind: "configuration",
    });
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function isConfigurationError(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

async function retryDelay(response: Response, attempt: number): Promise<number> {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const parsed = parseRetryAfter(retryAfter);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  const resetAfter = response.headers.get("x-ratelimit-reset-after");
  if (resetAfter) {
    const parsed = Number.parseFloat(resetAfter);
    if (Number.isFinite(parsed)) {
      return Math.min(parsed * 1000, MAX_RETRY_DELAY_MS);
    }
  }

  if (response.status === 429) {
    try {
      const body = (await response.clone().json()) as { retry_after?: number };
      if (typeof body.retry_after === "number") {
        return Math.min(body.retry_after * 1000, MAX_RETRY_DELAY_MS);
      }
    } catch {
      return fallbackRetryDelay(attempt);
    }
  }

  return fallbackRetryDelay(attempt);
}

async function webhookErrorMessage(
  webhookUrl: string,
  response: Response,
  redactionValues: string[],
): Promise<string> {
  return `Discord webhook request failed with ${response.status} for ${redactWebhookUrl(
    webhookUrl,
  )}: ${redactSecrets(await responseSnippet(response), redactionValues)}`;
}

async function responseSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500) || response.statusText;
  } catch {
    return response.statusText;
  }
}

function webhookExecuteUrl(webhookUrl: string, threadId?: string): string {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  if (threadId) {
    url.searchParams.set("thread_id", threadId);
  }

  return url.toString();
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryAfter(value: string): number | undefined {
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS);
  }

  return undefined;
}

function fallbackRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_DELAY_MS);
}

function webhookToken(webhookUrl: string): string {
  try {
    const segments = new URL(webhookUrl).pathname.split("/");
    return segments.at(-1) || "";
  } catch {
    return "";
  }
}
