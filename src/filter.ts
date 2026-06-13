import type { NormalizedPushEvent } from "./types";

interface FilterOptions {
  ignoredActors: string[];
  ignoredBranches: string[];
}

interface FilterDecision {
  reason: string;
  skip: boolean;
}

const DEPENDENCY_MESSAGE_PATTERNS = [
  /^build\(deps(?:-dev)?\):/i,
  /^chore\(deps(?:-dev)?\):/i,
  /^deps:/i,
  /^fix\(deps(?:-dev)?\):/i,
  /^update dependency /i,
  /^update .* dependencies/i,
  /^bump .+ from .+ to .+/i,
  /renovate/i,
  /dependabot/i,
];

export function shouldSkipDependencyUpdate(
  event: NormalizedPushEvent,
  options: FilterOptions,
): FilterDecision {
  const normalizedActor = event.actor.toLowerCase();
  const ignoredActor = options.ignoredActors.find(
    (actor) => actor.toLowerCase() === normalizedActor,
  );

  if (ignoredActor) {
    return { reason: `actor ${ignoredActor}`, skip: true };
  }

  const ignoredBranch = options.ignoredBranches.find((pattern) =>
    globMatches(pattern, event.branch),
  );

  if (ignoredBranch) {
    return { reason: `branch ${event.branch} matched ${ignoredBranch}`, skip: true };
  }

  if (
    event.commits.length > 0 &&
    event.commits.every((commit) => isDependencyUpdateMessage(commit.message))
  ) {
    return { reason: "commit messages look like dependency updates", skip: true };
  }

  return { reason: "", skip: false };
}

export function isDependencyUpdateMessage(message: string): boolean {
  const firstLine = message.split("\n")[0]?.trim() || "";
  return DEPENDENCY_MESSAGE_PATTERNS.some((pattern) => pattern.test(firstLine));
}

export function globMatches(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${globToRegex(pattern)}$`, "i");
  return regex.test(value);
}

function globToRegex(pattern: string): string {
  let regex = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] || "";
    const nextCharacter = pattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      regex += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      regex += "[^/]*";
      continue;
    }

    regex += escapeRegex(character);
  }

  return regex;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
