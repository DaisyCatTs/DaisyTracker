import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { readActionConfig } from "../src/action";

const GITHUB_TOKEN_EXPRESSION = "$" + "{{ github.token }}";

describe("repository metadata", () => {
  test("README documents every action input", async () => {
    const actionInputs = Object.keys(await actionInputMetadata());
    const readme = await readFile("README.md", "utf8");
    const documentedInputs = [...readme.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);

    expect(documentedInputs.sort()).toEqual(actionInputs.sort());
  });

  test("action.yml defaults match runtime config defaults", async () => {
    const metadata = await actionInputMetadata();
    const config = readActionConfig({});

    expect(metadata.color?.default).toBe("auto");
    expect(config.color).toBeUndefined();
    expect(metadata["dependency-updates"]?.default).toBe(config.dependencyUpdates);
    expect(metadata["fail-on-error"]?.default).toBe(String(config.failOnError));
    expect(metadata["github-token"]?.default).toBe(GITHUB_TOKEN_EXPRESSION);
    expect(metadata["ignored-actors"]?.default).toBe(config.ignoredActors.join(","));
    expect(metadata["ignored-branches"]?.default).toBe(config.ignoredBranches.join(","));
    expect(metadata["max-commits"]?.default).toBe(String(config.maxCommits));
    expect(metadata["max-files-per-section"]?.default).toBe(String(config.maxFilesPerSection));
    expect(metadata["max-messages"]?.default).toBe(String(config.maxMessages));
    expect(metadata["send-on-events"]?.default).toBe(config.sendOnEvents.join(","));
    expect(metadata["suppress-mentions"]?.default).toBe(String(config.suppressMentions));
    expect(metadata.username?.default).toBeUndefined();
    expect(config.username).toBe("");
  });
});

async function actionInputMetadata(): Promise<Record<string, { default?: string }>> {
  const action = await readFile("action.yml", "utf8");
  const inputSection = action.split(/\nruns:\r?\n/)[0]?.split(/\ninputs:\r?\n/)[1] || "";
  const inputs: Record<string, { default?: string }> = {};
  let currentInput = "";

  for (const line of inputSection.split(/\r?\n/)) {
    const inputMatch = line.match(/^ {2}([a-z0-9-]+):$/);
    if (inputMatch?.[1]) {
      currentInput = inputMatch[1];
      inputs[currentInput] = {};
      continue;
    }

    const defaultMatch = line.match(/^ {4}default: "?(.*?)"?$/);
    if (currentInput && defaultMatch?.[1] !== undefined) {
      inputs[currentInput] = { ...inputs[currentInput], default: defaultMatch[1] };
    }
  }

  return inputs;
}
