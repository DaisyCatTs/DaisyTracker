import { warn } from "./log";
import type { ActionConfig, DependencyUpdateMode } from "./types";

const DEFAULT_IGNORED_ACTORS = ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"];
const DEFAULT_IGNORED_BRANCHES = ["renovate/**", "dependabot/**"];

type Env = NodeJS.ProcessEnv;

export function readActionConfig(env: Env = process.env): ActionConfig {
  const githubTokenInput = parseToken(getInput("github-token", env));

  return {
    avatarUrl: getInput("avatar-url", env),
    color: parseOptionalColor(getInput("color", env)),
    dependencyUpdates: parseDependencyUpdateMode(getInput("dependency-updates", env) || "silent"),
    discordWebhookUrl: getInput("discord-webhook-url", env) || env.DISCORD_WEBHOOK_URL || "",
    failOnError: parseBoolean(getInput("fail-on-error", env), true),
    githubToken: githubTokenInput || parseToken(env.GITHUB_TOKEN || ""),
    ignoredActors: parseCsv(getInput("ignored-actors", env), DEFAULT_IGNORED_ACTORS),
    ignoredBranches: parseCsv(getInput("ignored-branches", env), DEFAULT_IGNORED_BRANCHES),
    maxCommits: parsePositiveInteger(getInput("max-commits", env), 10, 1, 50),
    maxFilesPerSection: parsePositiveInteger(getInput("max-files-per-section", env), 10, 0, 50),
    maxMessages: parsePositiveInteger(getInput("max-messages", env), 5, 1, 10),
    sendOnEvents: parseCsv(getInput("send-on-events", env), ["push"]).map((event) =>
      event.toLowerCase(),
    ),
    suppressMentions: parseBoolean(getInput("suppress-mentions", env), true),
    threadId: getInput("thread-id", env),
    threadName: getInput("thread-name", env),
    title: getInput("title", env),
    username: getInput("username", env),
  };
}

export function getInput(name: string, env: Env = process.env): string {
  const normalized = name.replace(/ /g, "_").toUpperCase();
  const candidates = [`INPUT_${normalized}`, `INPUT_${normalized.replace(/-/g, "_")}`];

  for (const candidate of candidates) {
    const value = env[candidate];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return "";
}

export function shouldFailOnError(env: Env = process.env): boolean {
  return parseBoolean(getInput("fail-on-error", env), true);
}

function parseCsv(value: string, fallback: string[]): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : fallback;
}

function parsePositiveInteger(
  value: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    warn(`Invalid numeric input "${value}". Falling back to ${fallback}.`);
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function parseBoolean(value: string, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  warn(`Invalid boolean input "${value}". Falling back to ${fallback}.`);
  return fallback;
}

function parseDependencyUpdateMode(value: string): DependencyUpdateMode {
  const normalized = value.toLowerCase();
  if (normalized === "compact" || normalized === "full" || normalized === "silent") {
    return normalized;
  }

  warn(`Invalid dependency-updates value "${value}". Falling back to "silent".`);
  return "silent";
}

function parseToken(value: string): string {
  return value.includes("${{") ? "" : value;
}

export function parseOptionalColor(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") {
    return undefined;
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(1), 16);
  }

  if (/^0x[0-9a-f]{6}$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(2), 16);
  }

  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number.parseInt(trimmed, 10), 0xffffff);
  }

  warn(`Invalid color value "${value}". Falling back to automatic language color.`);
  return undefined;
}
