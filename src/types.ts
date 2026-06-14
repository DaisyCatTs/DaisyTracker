import type { APIEmbed } from "discord-api-types/v10";

export type DependencyUpdateMode = "silent" | "compact" | "full";
export type RefType = "branch" | "tag" | "unknown";

export interface ActionConfig {
  avatarUrl: string;
  color?: number;
  dependencyUpdates: DependencyUpdateMode;
  discordWebhookUrl: string;
  failOnError: boolean;
  githubToken: string;
  ignoredActors: string[];
  ignoredBranches: string[];
  maxCommits: number;
  maxFilesPerSection: number;
  maxMessages: number;
  sendOnEvents: string[];
  suppressMentions: boolean;
  threadId: string;
  threadName: string;
  title: string;
  username: string;
}

export interface NormalizedUser {
  avatarUrl?: string;
  login: string;
  url?: string;
}

export interface NormalizedRepository {
  avatarUrl?: string;
  defaultBranch?: string;
  fullName: string;
  name: string;
  owner: string;
  url: string;
}

export interface CommitFileGroups {
  added: string[];
  modified: string[];
  renamed?: string[];
  removed: string[];
}

export interface NormalizedCommit extends CommitFileGroups {
  authorName: string;
  authorUsername?: string;
  id: string;
  message: string;
  timestamp?: string;
  url: string;
}

export interface NormalizedPushEvent {
  actor: string;
  after: string;
  before: string;
  branch: string;
  commits: NormalizedCommit[];
  commitsCapped: boolean;
  compareUrl?: string;
  created: boolean;
  deleted: boolean;
  eventName: "push";
  forced: boolean;
  headCommit?: NormalizedCommit;
  ref: string;
  refName: string;
  refType: RefType;
  repository: NormalizedRepository;
  runUrl?: string;
  sender?: NormalizedUser;
}

export interface UnsupportedEvent {
  eventName: string;
}

export type NormalizedEvent = NormalizedPushEvent | UnsupportedEvent;

export interface CommitStats {
  additions: number;
  deletions: number;
  total: number;
}

export interface CommitDetails extends CommitFileGroups {
  id: string;
  stats?: CommitStats;
}

export interface PushEnrichment {
  commitDetails: CommitDetails[];
  enrichmentNotes: string[];
  fileCount: number;
  fileCountCapped: boolean;
  fileGroups: Required<CommitFileGroups>;
  stats?: CommitStats;
}

export interface LanguageInfo {
  color: number;
  icon?: string;
  name: string;
}

export interface DiscordWebhookPayload {
  allowed_mentions?: {
    parse: Array<"users" | "roles" | "everyone">;
  };
  avatar_url?: string;
  embeds: APIEmbed[];
  thread_name?: string;
  username?: string;
}
