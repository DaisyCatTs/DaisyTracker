import { readFile } from "node:fs/promises";
import type {
  CommitFileGroups,
  NormalizedCommit,
  NormalizedEvent,
  NormalizedPushEvent,
  NormalizedRepository,
  NormalizedUser,
  RefType,
} from "./types";

type Env = NodeJS.ProcessEnv;
const GITHUB_PUSH_COMMIT_PAYLOAD_LIMIT = 2048;

interface PushPayload {
  after?: string;
  before?: string;
  created?: boolean;
  commits?: WebhookCommit[];
  compare?: string;
  deleted?: boolean;
  forced?: boolean;
  head_commit?: WebhookCommit | null;
  ref?: string;
  repository?: WebhookRepository;
  sender?: WebhookSender;
  pusher?: {
    email?: string;
    name?: string;
  };
}

interface WebhookCommit {
  added?: string[];
  author?: {
    email?: string;
    name?: string;
    username?: string;
  };
  committer?: {
    email?: string;
    name?: string;
    username?: string;
  };
  distinct?: boolean;
  id?: string;
  message?: string;
  modified?: string[];
  removed?: string[];
  timestamp?: string;
  url?: string;
}

interface WebhookRepository {
  default_branch?: string;
  full_name?: string;
  html_url?: string;
  name?: string;
  owner?: {
    avatar_url?: string;
    login?: string;
    name?: string;
  };
}

interface WebhookSender {
  avatar_url?: string;
  html_url?: string;
  login?: string;
}

export async function loadGitHubEvent(env: Env = process.env): Promise<NormalizedEvent> {
  const eventName = env.GITHUB_EVENT_NAME || "push";

  if (eventName !== "push") {
    return { eventName };
  }

  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("Missing GITHUB_EVENT_PATH. DaisyTracker must run inside GitHub Actions.");
  }

  const payload = JSON.parse(await readFile(eventPath, "utf8")) as PushPayload;
  return normalizePushPayload(payload, env);
}

export function normalizePushPayload(
  payload: PushPayload,
  env: Env = process.env,
): NormalizedPushEvent {
  const repository = normalizeRepository(payload.repository);
  const commits = (payload.commits || []).map((commit) => normalizeCommit(commit));
  const headCommit = payload.head_commit ? normalizeCommit(payload.head_commit) : commits.at(-1);
  const actor = env.GITHUB_ACTOR || payload.sender?.login || payload.pusher?.name || "unknown";
  const ref = payload.ref || env.GITHUB_REF || "";
  const refType = refTypeFromRef(ref);
  const refName = refNameFromRef(ref);
  const runUrl = env.GITHUB_RUN_ID
    ? `${repository.url}/actions/runs/${env.GITHUB_RUN_ID}`
    : undefined;

  return {
    actor,
    after: payload.after || headCommit?.id || "",
    before: payload.before || "",
    branch: refName,
    commits,
    commitsCapped: commits.length >= GITHUB_PUSH_COMMIT_PAYLOAD_LIMIT,
    compareUrl: payload.compare,
    created: Boolean(payload.created),
    deleted: Boolean(payload.deleted),
    eventName: "push",
    forced: Boolean(payload.forced),
    headCommit,
    ref,
    refName,
    refType,
    repository,
    runUrl,
    sender: normalizeSender(payload.sender),
  };
}

function normalizeRepository(repository?: WebhookRepository): NormalizedRepository {
  const fullName = repository?.full_name || "unknown/unknown";
  const [owner = "unknown", name = repository?.name || "unknown"] = fullName.split("/");

  return {
    avatarUrl: repository?.owner?.avatar_url,
    defaultBranch: repository?.default_branch,
    fullName,
    name,
    owner: repository?.owner?.login || repository?.owner?.name || owner,
    url: repository?.html_url || `https://github.com/${fullName}`,
  };
}

function normalizeSender(sender?: WebhookSender): NormalizedUser | undefined {
  if (!sender?.login) {
    return undefined;
  }

  return {
    avatarUrl: sender.avatar_url,
    login: sender.login,
    url: sender.html_url || `https://github.com/${sender.login}`,
  };
}

function normalizeCommit(commit: WebhookCommit): NormalizedCommit {
  const authorName = commit.author?.name || commit.committer?.name || "Unknown author";
  const authorUsername = commit.author?.username || commit.committer?.username;

  return {
    ...fileGroupsFromCommit(commit),
    authorName,
    authorUsername,
    id: commit.id || "",
    message: commit.message || "",
    timestamp: commit.timestamp,
    url: commit.url || "",
  };
}

function fileGroupsFromCommit(commit: WebhookCommit): CommitFileGroups {
  return {
    added: commit.added || [],
    modified: commit.modified || [],
    removed: commit.removed || [],
  };
}

function refNameFromRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}

function refTypeFromRef(ref: string): RefType {
  if (ref.startsWith("refs/heads/")) {
    return "branch";
  }
  if (ref.startsWith("refs/tags/")) {
    return "tag";
  }

  return "unknown";
}
