import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/action";
import dependencyPayload from "./fixtures/push.dependency.json";
import singlePayload from "./fixtures/push.single.json";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

describe("Action runtime", () => {
  test("minimal setup sends with only DISCORD_WEBHOOK_URL", async () => {
    const eventPath = await writeTempEvent("single", singlePayload);
    const calls: RequestInit[] = [];
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init || {});
      return new Response("", { status: 204 });
    };

    await run(
      {
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
        GITHUB_ACTOR: "DaisyCatTs",
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.body));
    expect(body.embeds[0].title).toBe("GitHub push delivered");
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(process.exitCode).not.toBe(1);
  });

  test("dependency bot pushes are silent by default", async () => {
    const eventPath = await writeTempEvent("dependency", dependencyPayload);
    const calls: RequestInit[] = [];
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init || {});
      return new Response("", { status: 204 });
    };

    await run(
      {
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
        GITHUB_ACTOR: "renovate[bot]",
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(calls).toHaveLength(0);
    expect(process.exitCode).not.toBe(1);
  });

  test("dependency compact mode sends one summary", async () => {
    const eventPath = await writeTempEvent("dependency-compact", dependencyPayload);
    const calls: RequestInit[] = [];
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init || {});
      return new Response("", { status: 204 });
    };

    await run(
      {
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
        GITHUB_ACTOR: "renovate[bot]",
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
        INPUT_DEPENDENCY_UPDATES: "compact",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.body)).embeds[0].title).toBe("Dependency update summarized");
  });

  test("dependency full mode sends normal push summaries", async () => {
    const eventPath = await writeTempEvent("dependency-full", dependencyPayload);
    const calls: RequestInit[] = [];
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init || {});
      return new Response("", { status: 204 });
    };

    await run(
      {
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
        GITHUB_ACTOR: "renovate[bot]",
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
        INPUT_DEPENDENCY_UPDATES: "full",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.body)).embeds[0].title).toBe("GitHub push delivered");
  });

  test("unsupported events exit successfully", async () => {
    const calls: RequestInit[] = [];
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init || {});
      return new Response("", { status: 204 });
    };

    await run(
      {
        GITHUB_EVENT_NAME: "issues",
        INPUT_SEND_ON_EVENTS: "issues",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(calls).toHaveLength(0);
    expect(process.exitCode).not.toBe(1);
  });

  test("missing webhook URL fails by default", async () => {
    const eventPath = await writeTempEvent("single-missing-webhook", singlePayload);

    await run({
      GITHUB_ACTOR: "DaisyCatTs",
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: eventPath,
    });

    expect(process.exitCode).toBe(1);
  });

  test("fail-on-error false warns and exits successfully", async () => {
    const eventPath = await writeTempEvent("single-fail-soft", singlePayload);
    const fetchMock = async () => new Response("bad payload", { status: 400 });

    await run(
      {
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
        GITHUB_ACTOR: "DaisyCatTs",
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
        INPUT_FAIL_ON_ERROR: "false",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(process.exitCode).not.toBe(1);
  });
});

async function writeTempEvent(name: string, payload: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gitracker-"));
  const path = join(directory, `${name}.json`);
  await writeFile(path, JSON.stringify(payload), "utf8");
  return path;
}
