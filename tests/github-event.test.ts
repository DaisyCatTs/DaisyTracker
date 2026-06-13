import { describe, expect, test } from "bun:test";
import { normalizePushPayload } from "../src/github-event";
import { cloneSinglePayload, eventFromPayload } from "./helpers";

describe("GitHub push event normalization", () => {
  test("normalizes tag pushes", () => {
    const payload = cloneSinglePayload();
    payload.ref = "refs/tags/v2.0.0";

    const event = eventFromPayload(payload);

    expect(event.refType).toBe("tag");
    expect(event.refName).toBe("v2.0.0");
    expect(event.branch).toBe("v2.0.0");
  });

  test("normalizes branch deletions without a head commit", () => {
    const payload = cloneSinglePayload();
    payload.deleted = true;
    payload.after = "0000000000000000000000000000000000000000";
    payload.commits = [];
    payload.head_commit = null;

    const event = eventFromPayload(payload);

    expect(event.deleted).toBe(true);
    expect(event.headCommit).toBeUndefined();
    expect(event.commits).toEqual([]);
  });

  test("normalizes empty push payloads", () => {
    const event = normalizePushPayload({
      after: "",
      before: "",
      commits: [],
      ref: "refs/heads/main",
      repository: {
        full_name: "DaisyCatTs/DaisyTracker",
        html_url: "https://github.com/DaisyCatTs/DaisyTracker",
        name: "DaisyTracker",
      },
    });

    expect(event.refName).toBe("main");
    expect(event.commits).toEqual([]);
  });

  test("marks force pushes", () => {
    const payload = cloneSinglePayload();
    payload.forced = true;

    const event = eventFromPayload(payload);

    expect(event.forced).toBe(true);
  });
});
