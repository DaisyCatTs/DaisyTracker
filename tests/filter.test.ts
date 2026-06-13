import { describe, expect, test } from "bun:test";
import { globMatches, isDependencyUpdateMessage, shouldSkipDependencyUpdate } from "../src/filter";
import { fixtureEvent } from "./helpers";

describe("dependency update filtering", () => {
  test("skips ignored bot actors", async () => {
    const event = await fixtureEvent("push.dependency.json");

    const decision = shouldSkipDependencyUpdate(event, {
      ignoredActors: ["renovate[bot]"],
      ignoredBranches: [],
    });

    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain("renovate[bot]");
  });

  test("skips ignored dependency branches", async () => {
    const event = await fixtureEvent("push.dependency.json");
    event.actor = "DaisyCatTs";

    const decision = shouldSkipDependencyUpdate(event, {
      ignoredActors: [],
      ignoredBranches: ["renovate/**", "dependabot/**"],
    });

    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain("renovate/**");
  });

  test("does not skip normal pushes", async () => {
    const event = await fixtureEvent("push.single.json");

    const decision = shouldSkipDependencyUpdate(event, {
      ignoredActors: ["renovate[bot]", "dependabot[bot]"],
      ignoredBranches: ["renovate/**", "dependabot/**"],
    });

    expect(decision.skip).toBe(false);
  });

  test("recognizes common dependency commit messages", () => {
    expect(isDependencyUpdateMessage("chore(deps): update dependency typescript to v6")).toBe(true);
    expect(isDependencyUpdateMessage("Bump axios from 1.7.7 to 1.17.0")).toBe(true);
    expect(isDependencyUpdateMessage("feat: add Discord dashboard")).toBe(false);
  });

  test("matches branch globs", () => {
    expect(globMatches("renovate/**", "renovate/typescript-6.x")).toBe(true);
    expect(globMatches("dependabot/**", "feature/dependabot-ui")).toBe(false);
  });
});
