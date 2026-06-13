import { readActionConfig, shouldFailOnError } from "./config";
import { sendDiscordPayloads } from "./discord";
import { buildCompactDependencyPayload, buildPushPayloads, buildRefDeletedPayload } from "./embed";
import { shouldSkipDependencyUpdate } from "./filter";
import { loadGitHubEvent } from "./github-event";
import { fetchCommitDetails } from "./github-api";
import { error as logError, info, mask, warn } from "./log";
import type { NormalizedEvent, NormalizedPushEvent } from "./types";

type Env = NodeJS.ProcessEnv;

export { getInput, parseOptionalColor as parseColor, readActionConfig } from "./config";

export async function run(
  env: Env = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  try {
    const config = readActionConfig(env);
    const eventName = env.GITHUB_EVENT_NAME || "push";
    const normalizedEventName = eventName.toLowerCase();

    if (!config.sendOnEvents.includes(normalizedEventName)) {
      info(`DaisyTracker skipped event "${eventName}" because send-on-events does not include it.`);
      return;
    }

    if (normalizedEventName !== "push") {
      info(`DaisyTracker currently supports push events. Event "${eventName}" was skipped.`);
      return;
    }

    if (!config.discordWebhookUrl) {
      throw new Error(
        "Missing Discord webhook URL. Set the discord-webhook-url input or DISCORD_WEBHOOK_URL.",
      );
    }

    mask(config.discordWebhookUrl);
    if (config.githubToken) {
      mask(config.githubToken);
    }

    const event = await loadGitHubEvent(env);
    if (!isPushEvent(event)) {
      info(`DaisyTracker currently supports push events. Event "${event.eventName}" was skipped.`);
      return;
    }

    const dependencyDecision = shouldSkipDependencyUpdate(event, {
      ignoredActors: config.ignoredActors,
      ignoredBranches: config.ignoredBranches,
    });

    if (dependencyDecision.skip && config.dependencyUpdates === "silent") {
      info(`DaisyTracker skipped dependency update noise: ${dependencyDecision.reason}.`);
      return;
    }

    if (dependencyDecision.skip && config.dependencyUpdates === "compact") {
      await sendDiscordPayloads(
        config.discordWebhookUrl,
        [buildCompactDependencyPayload(event, config, dependencyDecision.reason)],
        {
          fetch: fetchImpl,
          threadId: config.threadId,
        },
      );
      info("DaisyTracker sent a compact dependency update summary.");
      return;
    }

    if (event.deleted) {
      await sendDiscordPayloads(config.discordWebhookUrl, [buildRefDeletedPayload(event, config)], {
        fetch: fetchImpl,
        threadId: config.threadId,
      });
      info("DaisyTracker sent a deleted ref summary.");
      return;
    }

    const details = await fetchCommitDetails(event, {
      fetch: fetchImpl,
      maxCommits: config.maxCommits,
      token: config.githubToken,
    });
    const payloads = buildPushPayloads(event, details, config);

    await sendDiscordPayloads(config.discordWebhookUrl, payloads, {
      fetch: fetchImpl,
      threadId: config.threadId,
    });
    info(`DaisyTracker sent ${payloads.length} Discord webhook payload(s).`);
  } catch (error) {
    if (shouldFailOnError(env)) {
      setFailed(error);
    } else {
      warn(error instanceof Error ? error.message : String(error));
      process.exitCode = 0;
    }
  }
}

function setFailed(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exitCode = 1;
}

function isPushEvent(event: NormalizedEvent): event is NormalizedPushEvent {
  return event.eventName === "push" && "commits" in event;
}
