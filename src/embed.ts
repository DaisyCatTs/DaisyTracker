import type { APIEmbed, APIEmbedField } from "discord-api-types/v10";
import {
  DISCORD_LIMITS,
  appendFooterNote,
  canAddField,
  normalizeEmbed,
  truncate,
} from "./discord-limits";
import { detectDominantLanguage, languageIconUrl } from "./languages";
import type {
  ActionConfig,
  CommitDetails,
  CommitFileGroups,
  DiscordWebhookPayload,
  LanguageInfo,
  NormalizedCommit,
  NormalizedPushEvent,
} from "./types";

const MAX_PAYLOADS = 5;

interface AggregatedChanges extends Required<CommitFileGroups> {
  additions?: number;
  deletions?: number;
  total?: number;
}

export function buildPushPayloads(
  event: NormalizedPushEvent,
  details: CommitDetails[],
  config: ActionConfig,
): DiscordWebhookPayload[] {
  const changes = aggregateChanges(details);
  const language = detectDominantLanguage([
    ...changes.added,
    ...changes.modified,
    ...changes.renamed,
    ...changes.removed,
  ]);
  const latestCommit = event.headCommit || event.commits.at(-1);
  const thumbnailUrl = languageIconUrl(language) || event.repository.avatarUrl;
  const color = embedColor(config, language);
  const notes = eventNotes(event);

  const primaryEmbed: APIEmbed = normalizeEmbed({
    author: {
      icon_url: event.sender?.avatarUrl || event.repository.avatarUrl,
      name: `${event.actor} ${eventVerb(event)} ${refLabel(event)}`,
      url: event.sender?.url || event.repository.url,
    },
    color,
    description: buildDescription(event),
    fields: [
      inlineField("Repository", markdownLink(event.repository.fullName, event.repository.url)),
      inlineField("Ref", code(refLabel(event))),
      inlineField("Commits", commitCountLabel(event)),
      inlineField("Files", String(totalFileCount(changes))),
      inlineField("Lines", lineSummary(changes)),
      inlineField("Language", language.name),
      {
        inline: false,
        name: `Recent commits (${Math.min(event.commits.length, config.maxCommits)})`,
        value: formatCommitList(event.commits, config.maxCommits),
      },
    ],
    footer: {
      text: footerText(event, latestCommit),
    },
    thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
    timestamp: latestCommit?.timestamp
      ? new Date(latestCommit.timestamp).toISOString()
      : new Date().toISOString(),
    title: config.title || titleForPush(event),
    url: event.compareUrl || event.repository.url,
  });

  if (notes.length > 0) {
    primaryEmbed.fields = [
      ...(primaryEmbed.fields || []),
      {
        inline: false,
        name: "Notes",
        value: notes.join("\n"),
      },
    ];
  }

  const overflowFields: APIEmbedField[] = [];
  for (const field of [
    ...fileFields("Added files", changes.added, config.maxFilesPerSection),
    ...fileFields("Modified files", changes.modified, config.maxFilesPerSection),
    ...fileFields("Renamed files", changes.renamed, config.maxFilesPerSection),
    ...fileFields("Removed files", changes.removed, config.maxFilesPerSection),
  ]) {
    if (canAddField(primaryEmbed, field)) {
      primaryEmbed.fields = [...(primaryEmbed.fields || []), field];
    } else {
      overflowFields.push(field);
    }
  }

  const payloads = [payload(primaryEmbed, config)];
  for (const field of overflowFields) {
    const embed = normalizeEmbed({
      color,
      fields: [field],
      footer: {
        text: footerText(event, latestCommit),
      },
      title: field.name,
      url: event.compareUrl || event.repository.url,
    });
    payloads.push(payload(embed, config));
  }

  return capPayloads(payloads);
}

export function buildCompactDependencyPayload(
  event: NormalizedPushEvent,
  config: ActionConfig,
  reason: string,
): DiscordWebhookPayload {
  const latestCommit = event.headCommit || event.commits.at(-1);
  const language = detectDominantLanguage(event.commits.flatMap(commitFileNames));
  const embed = normalizeEmbed({
    color: embedColor(config, language),
    description:
      "A dependency automation update was detected. DaisyTracker is configured to avoid noisy full notifications for these updates.",
    fields: [
      inlineField("Repository", markdownLink(event.repository.fullName, event.repository.url)),
      inlineField("Ref", code(refLabel(event))),
      inlineField("Actor", code(event.actor)),
      inlineField("Commits", String(event.commits.length)),
      inlineField("Reason", reason || "dependency update"),
      {
        inline: false,
        name: "Latest commit",
        value: latestCommit ? formatCommit(latestCommit) : "_No commit available_",
      },
    ],
    footer: {
      text: footerText(event, latestCommit),
    },
    timestamp: latestCommit?.timestamp
      ? new Date(latestCommit.timestamp).toISOString()
      : new Date().toISOString(),
    title: "Dependency update summarized",
    url: event.compareUrl || event.repository.url,
  });

  return payload(embed, config);
}

export function buildRefDeletedPayload(
  event: NormalizedPushEvent,
  config: ActionConfig,
): DiscordWebhookPayload {
  const embed = normalizeEmbed({
    author: {
      icon_url: event.sender?.avatarUrl || event.repository.avatarUrl,
      name: `${event.actor} deleted ${refLabel(event)}`,
      url: event.sender?.url || event.repository.url,
    },
    color: config.color ?? 0xda3633,
    description: `${markdownLink(event.repository.fullName, event.repository.url)} had ${code(
      refLabel(event),
    )} deleted.`,
    fields: [
      inlineField("Repository", markdownLink(event.repository.fullName, event.repository.url)),
      inlineField("Ref", code(refLabel(event))),
      inlineField("Previous", code(shortSha(event.before))),
    ],
    footer: {
      text: footerText(event),
    },
    timestamp: new Date().toISOString(),
    title: config.title || "GitHub ref deleted",
    url: event.repository.url,
  });

  return payload(embed, config);
}

function payload(embed: APIEmbed, config: ActionConfig): DiscordWebhookPayload {
  return {
    allowed_mentions: config.suppressMentions ? { parse: [] } : undefined,
    avatar_url: config.avatarUrl || undefined,
    embeds: [embed],
    thread_name: config.threadName || undefined,
    username: truncate(config.username || "DaisyTracker", DISCORD_LIMITS.username),
  };
}

function aggregateChanges(details: CommitDetails[]): AggregatedChanges {
  const added = new Set<string>();
  const modified = new Set<string>();
  const renamed = new Set<string>();
  const removed = new Set<string>();
  let additions = 0;
  let deletions = 0;
  let total = 0;
  let hasStats = false;

  for (const detail of details) {
    for (const file of detail.added) {
      added.add(file);
    }
    for (const file of detail.modified) {
      modified.add(file);
    }
    for (const file of detail.renamed || []) {
      renamed.add(file);
    }
    for (const file of detail.removed) {
      removed.add(file);
    }

    if (detail.stats) {
      hasStats = true;
      additions += detail.stats.additions;
      deletions += detail.stats.deletions;
      total += detail.stats.total;
    }
  }

  return {
    added: [...added].sort(),
    additions: hasStats ? additions : undefined,
    deletions: hasStats ? deletions : undefined,
    modified: [...modified].sort(),
    renamed: [...renamed].sort(),
    removed: [...removed].sort(),
    total: hasStats ? total : undefined,
  };
}

function buildDescription(event: NormalizedPushEvent): string {
  const commits = `**${event.commits.length}** commit${event.commits.length === 1 ? "" : "s"}`;
  const compare = event.compareUrl ? ` ${markdownLink("View comparison", event.compareUrl)}.` : "";
  return `${commits} landed in ${markdownLink(event.repository.fullName, event.repository.url)} on ${code(
    refLabel(event),
  )}.${compare}`;
}

function eventNotes(event: NormalizedPushEvent): string[] {
  const notes: string[] = [];
  if (event.created) {
    notes.push("This push created the ref.");
  }
  if (event.forced) {
    notes.push("This was a force push.");
  }
  if (event.commitsCapped) {
    notes.push(
      "GitHub caps push payloads at 2048 commits; this summary may not include every commit.",
    );
  }

  return notes;
}

function inlineField(name: string, value: string): APIEmbedField {
  return { inline: true, name, value };
}

function fileFields(name: string, files: string[], maxFiles: number): APIEmbedField[] {
  if (files.length === 0 || maxFiles === 0) {
    return [];
  }

  const visibleFiles = files.slice(0, maxFiles);
  const lines = visibleFiles.map((file) => code(file));
  if (files.length > visibleFiles.length) {
    lines.push(`_and ${files.length - visibleFiles.length} more_`);
  }

  return chunkLines(lines, DISCORD_LIMITS.fieldValue).map((value, index) => ({
    inline: false,
    name: index === 0 ? `${name} (${files.length})` : `${name} (${index + 1})`,
    value,
  }));
}

function chunkLines(lines: string[], limit: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit && current) {
      chunks.push(current);
      current = line;
    } else if (line.length > limit) {
      chunks.push(truncate(line, limit));
      current = "";
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function formatCommitList(commits: NormalizedCommit[], maxCommits: number): string {
  const visibleCommits = commits.slice(-maxCommits).reverse();
  if (visibleCommits.length === 0) {
    return "_No commits available_";
  }

  const lines = visibleCommits.map(formatCommit);
  if (commits.length > visibleCommits.length) {
    lines.push(`_and ${commits.length - visibleCommits.length} more_`);
  }

  return truncate(lines.join("\n"), DISCORD_LIMITS.fieldValue);
}

function formatCommit(commit: NormalizedCommit): string {
  const shortMessage = firstLine(commit.message);
  const shortId = shortSha(commit.id);
  const linkedSha = commit.url ? markdownLink(code(shortId), commit.url) : code(shortId);
  return `${linkedSha} ${truncate(shortMessage, 140)}`;
}

function capPayloads(payloads: DiscordWebhookPayload[]): DiscordWebhookPayload[] {
  if (payloads.length <= MAX_PAYLOADS) {
    return payloads;
  }

  const capped = payloads.slice(0, MAX_PAYLOADS);
  const lastEmbed = capped.at(-1)?.embeds[0];
  if (lastEmbed) {
    appendFooterNote(lastEmbed, `Output truncated to ${MAX_PAYLOADS} messages.`);
  }

  return capped;
}

function lineSummary(changes: AggregatedChanges): string {
  if (
    typeof changes.additions !== "number" ||
    typeof changes.deletions !== "number" ||
    typeof changes.total !== "number"
  ) {
    return "Unavailable";
  }

  return `+${changes.additions} / -${changes.deletions} (${changes.total})`;
}

function totalFileCount(changes: Required<CommitFileGroups>): number {
  return (
    changes.added.length + changes.modified.length + changes.renamed.length + changes.removed.length
  );
}

function footerText(event: NormalizedPushEvent, latestCommit?: NormalizedCommit): string {
  const parts = [`Latest ${shortSha(latestCommit?.id || event.after || event.before)}`];
  if (event.runUrl) {
    parts.push(`Run: ${event.runUrl}`);
  }

  return parts.join(" | ");
}

function commitCountLabel(event: NormalizedPushEvent): string {
  return event.commitsCapped ? `${event.commits.length}+` : String(event.commits.length);
}

function titleForPush(event: NormalizedPushEvent): string {
  if (event.created) {
    return `GitHub ${event.refType} created`;
  }
  if (event.forced) {
    return "GitHub force push delivered";
  }

  return "GitHub push delivered";
}

function eventVerb(event: NormalizedPushEvent): string {
  if (event.created) {
    return "created";
  }
  if (event.forced) {
    return "force-pushed to";
  }

  return "pushed to";
}

function refLabel(event: NormalizedPushEvent): string {
  const type = event.refType === "unknown" ? "ref" : event.refType;
  return `${type}:${event.refName || "unknown"}`;
}

function embedColor(config: ActionConfig, language: LanguageInfo): number {
  return config.color ?? language.color;
}

function commitFileNames(commit: NormalizedCommit): string[] {
  return [...commit.added, ...commit.modified, ...(commit.renamed || []), ...commit.removed];
}

function markdownLink(label: string, url: string): string {
  return `[${label}](${url})`;
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() || "_No commit message_";
}

function shortSha(sha = ""): string {
  return sha.slice(0, 7) || "unknown";
}
