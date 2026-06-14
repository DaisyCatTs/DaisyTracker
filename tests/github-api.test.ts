import { describe, expect, test } from "bun:test";
import { fetchCommitDetails, fetchPushEnrichment } from "../src/github-api";
import { fixtureEvent } from "./helpers";

describe("GitHub commit detail fetching", () => {
  test("falls back to webhook commit files without a token", async () => {
    const event = await fixtureEvent("push.single.json");

    const details = await fetchCommitDetails(event, {
      maxCommits: 10,
      token: "",
    });

    expect(details[0]?.added).toContain("src/index.ts");
    expect(details[0]?.stats).toBeUndefined();
  });

  test("falls back to webhook commit files on API failure", async () => {
    const event = await fixtureEvent("push.single.json");
    const details = await fetchCommitDetails(event, {
      fetch: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
      maxCommits: 10,
      token: "token",
    });

    expect(details[0]?.modified).toContain("README.md");
  });

  test("uses GitHub API commit stats and renamed files when available", async () => {
    const event = await fixtureEvent("push.single.json");
    const details = await fetchCommitDetails(event, {
      fetch: (async () =>
        new Response(
          JSON.stringify({
            files: [
              { filename: "src/new.ts", previous_filename: "src/old.ts", status: "renamed" },
              { filename: "src/created.ts", status: "added" },
              { filename: "README.md", status: "modified" },
              { filename: "old.txt", status: "removed" },
            ],
            stats: { additions: 10, deletions: 4, total: 14 },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      maxCommits: 10,
      token: "token",
    });

    expect(details[0]?.stats).toEqual({ additions: 10, deletions: 4, total: 14 });
    expect(details[0]?.renamed).toContain("src/old.ts -> src/new.ts");
    expect(details[0]?.added).toContain("src/created.ts");
    expect(details[0]?.modified).toContain("README.md");
    expect(details[0]?.removed).toContain("old.txt");
  });

  test("falls back only for failed commit detail requests", async () => {
    const event = await fixtureEvent("push.single.json");
    event.commits.push({
      added: ["src/second.ts"],
      authorName: "Daisy",
      id: "3333333333333333333333333333333333333333",
      message: "feat: second",
      modified: [],
      removed: [],
      url: "https://github.com/DaisyCatTs/DaisyTracker/commit/3333333",
    });

    let calls = 0;
    const details = await fetchCommitDetails(event, {
      fetch: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("nope", { status: 500 });
        }

        return new Response(
          JSON.stringify({
            files: [{ filename: "src/api.ts", status: "added" }],
            stats: { additions: 1, deletions: 0, total: 1 },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
      maxCommits: 10,
      token: "token",
    });

    expect(details[0]?.modified).toContain("README.md");
    expect(details[1]?.added).toEqual(["src/api.ts"]);
  });

  test("uses compare API file groups and line stats when available", async () => {
    const event = await fixtureEvent("push.single.json");
    const urls: string[] = [];
    const enrichment = await fetchPushEnrichment(event, {
      fetch: (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify({
            files: [
              {
                additions: 5,
                changes: 8,
                deletions: 3,
                filename: "src/new.ts",
                previous_filename: "src/old.ts",
                status: "renamed",
              },
              {
                additions: 1,
                changes: 1,
                deletions: 0,
                filename: "src/created.ts",
                status: "added",
              },
            ],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
      maxCommits: 10,
      token: "token",
    });

    expect(urls[0]).toContain("/compare/");
    expect(enrichment.fileGroups.renamed).toContain("src/old.ts -> src/new.ts");
    expect(enrichment.fileGroups.added).toContain("src/created.ts");
    expect(enrichment.stats).toEqual({ additions: 6, deletions: 3, total: 9 });
  });

  test("falls back to commit API when compare API fails", async () => {
    const event = await fixtureEvent("push.single.json");
    let calls = 0;
    const enrichment = await fetchPushEnrichment(event, {
      fetch: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("nope", { status: 500 });
        }

        return new Response(
          JSON.stringify({
            files: [{ filename: "src/fallback.ts", status: "added" }],
            stats: { additions: 2, deletions: 0, total: 2 },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
      maxCommits: 10,
      token: "token",
    });

    expect(calls).toBeGreaterThan(1);
    expect(enrichment.fileGroups.added).toContain("src/fallback.ts");
    expect(enrichment.stats).toEqual({ additions: 2, deletions: 0, total: 2 });
  });

  test("marks compare file lists that may be capped by GitHub", async () => {
    const event = await fixtureEvent("push.single.json");
    const enrichment = await fetchPushEnrichment(event, {
      fetch: (async () =>
        new Response(
          JSON.stringify({
            files: Array.from({ length: 300 }, (_, index) => ({
              filename: `src/file-${index}.ts`,
              status: "modified",
            })),
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      maxCommits: 10,
      token: "token",
    });

    expect(enrichment.fileCountCapped).toBe(true);
    expect(enrichment.enrichmentNotes.join(" ")).toContain("300 files");
  });

  test("limits commit API request concurrency", async () => {
    const event = await fixtureEvent("push.single.json");
    const baseCommit = event.commits[0];
    if (!baseCommit) {
      throw new Error("Expected fixture commit.");
    }
    event.commits = Array.from({ length: 8 }, (_, index) => ({
      ...baseCommit,
      id: String(index).padStart(40, "0"),
    }));

    let active = 0;
    let maxActive = 0;
    const details = await fetchCommitDetails(event, {
      concurrency: 2,
      fetch: (async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return new Response(
          JSON.stringify({ files: [], stats: { additions: 0, deletions: 0, total: 0 } }),
          {
            status: 200,
          },
        );
      }) as unknown as typeof fetch,
      maxCommits: 8,
      token: "token",
    });

    expect(details).toHaveLength(8);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
