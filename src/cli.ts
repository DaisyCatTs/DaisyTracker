import { readFile } from "node:fs/promises";
import { buildPushPayloads } from "./embed";
import { normalizePushPayload } from "./github-event";
import { fetchCommitDetails } from "./github-api";
import { readActionConfig } from "./action";

const fixturePath =
  process.argv[2] || process.env.GITHUB_EVENT_PATH || "tests/fixtures/push.single.json";
const payload = JSON.parse(await readFile(fixturePath, "utf8"));
const event = normalizePushPayload(payload, {
  ...process.env,
  GITHUB_EVENT_NAME: "push",
});
const config = readActionConfig({
  ...process.env,
  INPUT_DEPENDENCY_UPDATES: process.env.INPUT_DEPENDENCY_UPDATES || "full",
});
const details = await fetchCommitDetails(event, {
  maxCommits: config.maxCommits,
  token: config.githubToken,
});

console.log(JSON.stringify(buildPushPayloads(event, details, config), null, 2));
