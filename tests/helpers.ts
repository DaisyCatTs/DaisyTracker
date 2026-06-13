import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizePushPayload } from "../src/github-event";
import type { ActionConfig, DiscordWebhookPayload, NormalizedPushEvent } from "../src/types";
import singlePayload from "./fixtures/push.single.json";

export async function fixtureEvent(name: string): Promise<NormalizedPushEvent> {
  const fixturePath = join(import.meta.dir, "fixtures", name);
  const payload = JSON.parse(await readFile(fixturePath, "utf8"));
  return normalizePushPayload(payload, {
    GITHUB_ACTOR: payload.sender?.login,
    GITHUB_EVENT_NAME: "push",
    GITHUB_RUN_ID: "123456789",
  });
}

export function defaultConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    avatarUrl: "",
    color: 0x1abc9c,
    dependencyUpdates: "silent",
    discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
    failOnError: true,
    githubToken: "",
    ignoredActors: ["renovate[bot]", "dependabot[bot]"],
    ignoredBranches: ["renovate/**", "dependabot/**"],
    maxCommits: 10,
    maxFilesPerSection: 10,
    sendOnEvents: ["push"],
    suppressMentions: true,
    threadId: "",
    threadName: "",
    title: "",
    username: "Gitracker",
    ...overrides,
  };
}

export function eventFromPayload(payload: Record<string, unknown>): NormalizedPushEvent {
  return normalizePushPayload(payload, {
    GITHUB_ACTOR: (payload.sender as { login?: string } | undefined)?.login,
    GITHUB_EVENT_NAME: "push",
    GITHUB_RUN_ID: "123456789",
  });
}

export function cloneSinglePayload(): Record<string, unknown> {
  return structuredClone(singlePayload) as Record<string, unknown>;
}

export function embedTextLength(payload: DiscordWebhookPayload): number {
  return payload.embeds.reduce((total, embed) => {
    const fields = embed.fields || [];
    return (
      total +
      String(embed.title || "").length +
      String(embed.description || "").length +
      String(embed.footer?.text || "").length +
      String(embed.author?.name || "").length +
      fields.reduce(
        (fieldTotal: number, field: { name?: string; value?: string }) =>
          fieldTotal + String(field.name || "").length + String(field.value || "").length,
        0,
      )
    );
  }, 0);
}
