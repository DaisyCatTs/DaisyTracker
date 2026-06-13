import { describe, expect, test } from "bun:test";
import { fetchCommitDetails } from "../src/github-api";
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
      url: "https://github.com/DaisyCatTs/Gitracker/commit/3333333",
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
});
