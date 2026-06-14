import { describe, expect, test } from "bun:test";
import { getInput, parseColor, readActionConfig } from "../src/action";

describe("Action config", () => {
  test("reads new v2 inputs", () => {
    const config = readActionConfig({
      INPUT_AVATAR_URL: "https://example.com/avatar.png",
      INPUT_COLOR: "#ff00aa",
      INPUT_FAIL_ON_ERROR: "false",
      INPUT_MAX_MESSAGES: "7",
      INPUT_SUPPRESS_MENTIONS: "false",
      INPUT_THREAD_ID: "123",
      INPUT_THREAD_NAME: "deploys",
      INPUT_USERNAME: "Repo Watch",
    });

    expect(config.avatarUrl).toBe("https://example.com/avatar.png");
    expect(config.color).toBe(0xff00aa);
    expect(config.failOnError).toBe(false);
    expect(config.maxMessages).toBe(7);
    expect(config.suppressMentions).toBe(false);
    expect(config.threadId).toBe("123");
    expect(config.threadName).toBe("deploys");
    expect(config.username).toBe("Repo Watch");
  });

  test("uses automatic color when color is omitted or auto", () => {
    expect(parseColor("")).toBeUndefined();
    expect(parseColor("auto")).toBeUndefined();
  });

  test("falls back to DISCORD_WEBHOOK_URL and GITHUB_TOKEN env vars", () => {
    const config = readActionConfig({
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
      GITHUB_TOKEN: "github-token",
    });

    expect(config.discordWebhookUrl).toBe("https://discord.com/api/webhooks/123/token");
    expect(config.githubToken).toBe("github-token");
  });

  test("supports dashed and underscored action input env names", () => {
    expect(
      getInput("discord-webhook-url", {
        INPUT_DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
      }),
    ).toBe("https://discord.com/api/webhooks/123/token");
  });

  test("clamps max-messages to the supported Discord message range", () => {
    expect(readActionConfig({ INPUT_MAX_MESSAGES: "0" }).maxMessages).toBe(1);
    expect(readActionConfig({ INPUT_MAX_MESSAGES: "50" }).maxMessages).toBe(10);
  });
});
