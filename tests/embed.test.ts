import { describe, expect, test } from "bun:test";
import {
  buildCompactDependencyPayload,
  buildPushPayloads,
  buildRefDeletedPayload,
} from "../src/embed";
import type { CommitDetails } from "../src/types";
import {
  cloneSinglePayload,
  defaultConfig,
  embedTextLength,
  eventFromPayload,
  fixtureEvent,
} from "./helpers";

const baseConfig = defaultConfig();
const GITHUB_TOKEN_EXPRESSION = "$" + "{{ github.token }}";

describe("Discord embed payloads", () => {
  test("builds a polished push payload within Discord limits", async () => {
    const event = await fixtureEvent("push.single.json");
    const payloads = buildPushPayloads(
      event,
      [
        {
          added: ["src/index.ts"],
          id: event.commits[0]?.id || "",
          modified: ["README.md"],
          removed: [],
          stats: { additions: 120, deletions: 20, total: 140 },
        },
      ],
      baseConfig,
    );

    expect(payloads).toHaveLength(1);
    const firstPayload = payloads[0];
    expect(firstPayload).toBeDefined();
    expect(firstPayload?.embeds[0]?.title).toBe("Push delivered");
    if (!firstPayload) {
      throw new Error("Expected first payload.");
    }
    expect(firstPayload.allowed_mentions).toEqual({ parse: [] });
    expect(firstPayload.username).toBeUndefined();
    expect(embedTextLength(firstPayload)).toBeLessThanOrEqual(6000);
    expect(firstPayload?.embeds[0]?.fields?.length).toBeLessThanOrEqual(25);
  });

  test("splits oversized file sections into capped payloads", async () => {
    const event = await fixtureEvent("push.single.json");
    const files = Array.from(
      { length: 80 },
      (_, index) =>
        `src/generated/${index.toString().padStart(2, "0")}/${"very-long-directory-name/".repeat(6)}very-long-file-name.ts`,
    );
    const details: CommitDetails[] = [
      {
        added: files,
        id: event.commits[0]?.id || "",
        modified: files,
        removed: files,
      },
    ];

    const payloads = buildPushPayloads(event, details, {
      ...baseConfig,
      maxFilesPerSection: 50,
    });

    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.length).toBeLessThanOrEqual(5);
    for (const payload of payloads) {
      expect(embedTextLength(payload)).toBeLessThanOrEqual(6000);
      expect(payload.embeds[0]?.fields?.length || 0).toBeLessThanOrEqual(25);
    }
  });

  test("builds compact dependency summaries", async () => {
    const event = await fixtureEvent("push.dependency.json");
    const payload = buildCompactDependencyPayload(event, baseConfig, "actor renovate[bot]");

    expect(payload.embeds[0]?.title).toBe("Dependency update summarized");
    expect(JSON.stringify(payload)).toContain("actor renovate[bot]");
  });

  test("includes webhook identity and thread name overrides", async () => {
    const event = await fixtureEvent("push.single.json");
    const payloads = buildPushPayloads(
      event,
      [],
      defaultConfig({
        avatarUrl: "https://example.com/avatar.png",
        threadName: "deploys",
        username: "Repo Watch",
      }),
    );

    expect(payloads[0]?.username).toBe("Repo Watch");
    expect(payloads[0]?.avatar_url).toBe("https://example.com/avatar.png");
    expect(payloads[0]?.thread_name).toBe("deploys");
  });

  test("uses language color when color is automatic", async () => {
    const event = await fixtureEvent("push.single.json");
    const payloads = buildPushPayloads(
      event,
      [
        {
          added: ["src/index.ts"],
          id: event.commits[0]?.id || "",
          modified: [],
          removed: [],
        },
      ],
      defaultConfig({ color: undefined }),
    );

    expect(payloads[0]?.embeds[0]?.color).toBe(0x3178c6);
  });

  test("adds renamed file sections from GitHub API details", async () => {
    const event = await fixtureEvent("push.single.json");
    const payloads = buildPushPayloads(
      event,
      [
        {
          added: [],
          id: event.commits[0]?.id || "",
          modified: [],
          renamed: ["src/old.ts -> src/new.ts"],
          removed: [],
        },
      ],
      baseConfig,
    );

    expect(JSON.stringify(payloads)).toContain("Renamed files");
    expect(JSON.stringify(payloads)).toContain("src/old.ts -> src/new.ts");
  });

  test("builds branch deletion summaries without commit details", () => {
    const payload = cloneSinglePayload();
    payload.deleted = true;
    payload.after = "0000000000000000000000000000000000000000";
    payload.commits = [];
    payload.head_commit = null;
    const event = eventFromPayload(payload);

    const message = buildRefDeletedPayload(event, baseConfig);

    expect(message.embeds[0]?.title).toBe("Branch deleted");
    expect(JSON.stringify(message)).toContain("branch:master");
  });

  test("marks created and forced pushes", () => {
    const payload = cloneSinglePayload();
    payload.created = true;
    payload.forced = true;
    const event = eventFromPayload(payload);

    const messages = buildPushPayloads(event, [], baseConfig);

    expect(messages[0]?.embeds[0]?.title).toBe("Branch created");
    expect(JSON.stringify(messages)).toContain("force push");
  });

  test("reports huge push commit payload caps", () => {
    const payload = cloneSinglePayload();
    const commit = (payload.commits as unknown[])[0] as Record<string, unknown>;
    payload.commits = Array.from({ length: 2048 }, (_, index) => ({
      ...commit,
      id: String(index).padStart(40, "a"),
      message: `feat: change ${index}`,
    }));
    const event = eventFromPayload(payload);

    const messages = buildPushPayloads(event, [], baseConfig);

    expect(messages[0]?.embeds[0]?.fields?.find((field) => field.name === "Commits")?.value).toBe(
      "2048+",
    );
    expect(JSON.stringify(messages)).toContain("GitHub caps push payloads");
  });

  test("keeps long branch names, commit messages, and file paths within limits", () => {
    const payload = cloneSinglePayload();
    payload.ref = `refs/heads/feature/${"very-long-branch-name-".repeat(12)}`;
    const commit = (payload.commits as Array<Record<string, unknown>>)[0];
    if (!commit) {
      throw new Error("Expected fixture commit.");
    }
    commit.message = `feat: ${"ship an extremely detailed Discord dashboard ".repeat(20)}`;
    const event = eventFromPayload(payload);

    const messages = buildPushPayloads(
      event,
      [
        {
          added: [`src/${"deep-directory/".repeat(20)}component-with-a-very-long-file-name.ts`],
          id: event.commits[0]?.id || "",
          modified: [],
          removed: [],
        },
      ],
      defaultConfig({ maxFilesPerSection: 50 }),
    );

    for (const message of messages) {
      expect(embedTextLength(message)).toBeLessThanOrEqual(6000);
      expect(message.embeds[0]?.fields?.length || 0).toBeLessThanOrEqual(25);
    }
  });

  test("caps payload count with max-messages and marks truncation", async () => {
    const event = await fixtureEvent("push.single.json");
    const files = Array.from(
      { length: 120 },
      (_, index) =>
        `src/generated/${index.toString().padStart(3, "0")}/${"deep-directory/".repeat(
          12,
        )}component.ts`,
    );

    const messages = buildPushPayloads(
      event,
      [
        {
          added: files,
          id: event.commits[0]?.id || "",
          modified: files,
          removed: files,
        },
      ],
      defaultConfig({ maxFilesPerSection: 120, maxMessages: 2 }),
    );

    expect(messages).toHaveLength(2);
    expect(messages.at(-1)?.embeds[0]?.footer?.text).toContain("Output truncated to 2 messages");
  });

  test("marks normalized text shortening in the footer", async () => {
    const event = await fixtureEvent("push.single.json");
    const messages = buildPushPayloads(event, [], {
      ...baseConfig,
      title: "x".repeat(300),
    });

    expect(messages[0]?.embeds[0]?.title?.length).toBeLessThanOrEqual(256);
    expect(messages[0]?.embeds[0]?.footer?.text).toContain("text shortened");
  });

  test("shows unavailable file details instead of misleading zero counts", async () => {
    const event = await fixtureEvent("push.single.json");
    const messages = buildPushPayloads(
      event,
      {
        commitDetails: [],
        enrichmentNotes: [
          `Changed-file details need GitHub API credentials for private repositories. Pass github-token: ${GITHUB_TOKEN_EXPRESSION}.`,
        ],
        fileDetailsUnavailable: true,
        fileCount: 0,
        fileCountCapped: false,
        fileGroups: {
          added: [],
          modified: [],
          renamed: [],
          removed: [],
        },
      },
      baseConfig,
    );

    const fields = messages[0]?.embeds[0]?.fields || [];
    expect(fields.find((field) => field.name === "Files")?.value).toBe("Unavailable");
    expect(fields.find((field) => field.name === "Language")?.value).toBe("Unavailable");
    expect(JSON.stringify(messages)).toContain("github-token");
  });
});
