import { validateDiscordWebhookPayload } from "./discord-limits";
import type { DiscordWebhookPayload } from "./types";

interface SendOptions {
  fetch?: typeof fetch;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  threadId?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;

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
  const url = webhookExecuteUrl(webhookUrl, options.threadId);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "DaisyCatTs-DaisyTracker",
      },
      method: "POST",
    });

    if (response.ok) {
      return;
    }

    if (isConfigurationError(response.status)) {
      throw new Error(await webhookErrorMessage(webhookUrl, response));
    }

    if (attempt < maxAttempts && shouldRetry(response.status)) {
      await sleep(await retryDelay(response));
      continue;
    }

    throw new Error(await webhookErrorMessage(webhookUrl, response));
  }
}

function validateWebhookUrl(webhookUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("Discord webhook URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Discord webhook URL must use https.");
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function isConfigurationError(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

async function retryDelay(response: Response): Promise<number> {
  const headerDelay =
    response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset-after");
  if (headerDelay) {
    return Math.min(Number.parseFloat(headerDelay) * 1000, 10_000);
  }

  if (response.status === 429) {
    try {
      const body = (await response.clone().json()) as { retry_after?: number };
      if (typeof body.retry_after === "number") {
        return Math.min(body.retry_after * 1000, 10_000);
      }
    } catch {
      return 1000;
    }
  }

  return 1000;
}

async function webhookErrorMessage(webhookUrl: string, response: Response): Promise<string> {
  return `Discord webhook request failed with ${response.status} for ${redactWebhookUrl(
    webhookUrl,
  )}: ${await responseSnippet(response)}`;
}

async function responseSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500) || response.statusText;
  } catch {
    return response.statusText;
  }
}

function redactWebhookUrl(webhookUrl: string): string {
  return webhookUrl.replace(/(\/api\/webhooks\/\d+\/)[^/?]+/i, "$1***");
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
