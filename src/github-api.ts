import { warn } from "./log";
import type {
  CommitDetails,
  CommitFileGroups,
  CommitStats,
  NormalizedCommit,
  NormalizedPushEvent,
  PushEnrichment,
} from "./types";

interface FetchCommitDetailsOptions {
  fetch?: typeof fetch;
  concurrency?: number;
  forceApi?: boolean;
  maxCommits: number;
  timeoutMs?: number;
  token: string;
}

interface GitHubCommitResponse {
  files?: Array<{
    additions?: number;
    changes?: number;
    deletions?: number;
    filename?: string;
    previous_filename?: string;
    status?: string;
  }>;
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
}

interface GitHubCompareResponse {
  files?: GitHubCommitResponse["files"];
  total_commits?: number;
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 10_000;
const GITHUB_COMPARE_FILE_LIMIT = 300;

export async function fetchPushEnrichment(
  event: NormalizedPushEvent,
  options: FetchCommitDetailsOptions,
): Promise<PushEnrichment> {
  const visibleCommits = event.commits.slice(-options.maxCommits);
  const payloadDetails = event.commits.map(commitDetailsFromPayload);
  const visiblePayloadDetails = visibleCommits.map(commitDetailsFromPayload);

  if (!options.token && hasFileDetails(payloadDetails)) {
    return enrichmentFromDetails(visiblePayloadDetails, payloadDetails);
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  const compare = await fetchCompareEnrichment(event, options.token, fetchImpl, options.timeoutMs, {
    warnOnFailure: Boolean(options.token),
  });
  if (compare) {
    return {
      commitDetails: visiblePayloadDetails,
      enrichmentNotes: compare.enrichmentNotes,
      fileCount: compare.fileCount,
      fileCountCapped: compare.fileCountCapped,
      fileGroups: compare.fileGroups,
      stats: compare.stats,
    };
  }

  const commitDetails = await fetchCommitDetails(event, {
    ...options,
    forceApi: !options.token && !hasFileDetails(payloadDetails),
  });
  const enrichment = enrichmentFromDetails(commitDetails, commitDetails);
  if (event.commits.length > commitDetails.length) {
    enrichment.enrichmentNotes.push(
      `File details are limited to the latest ${commitDetails.length} commit${
        commitDetails.length === 1 ? "" : "s"
      } because compare enrichment was unavailable.`,
    );
  }

  return enrichment;
}

export async function fetchCommitDetails(
  event: NormalizedPushEvent,
  options: FetchCommitDetailsOptions,
): Promise<CommitDetails[]> {
  const commits = event.commits.slice(-options.maxCommits);

  if (!options.token && !options.forceApi) {
    return commits.map(commitDetailsFromPayload);
  }

  return mapWithConcurrency(commits, options.concurrency || DEFAULT_CONCURRENCY, async (commit) => {
    try {
      return await fetchCommitDetail(
        event,
        commit,
        options.token,
        options.fetch || globalThis.fetch,
        options.timeoutMs || DEFAULT_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(
        `Could not fetch commit details for ${shortSha(commit.id)}. Using webhook payload data. ${message}`,
      );
      return commitDetailsFromPayload(commit);
    }
  });
}

function commitDetailsFromPayload(commit: NormalizedCommit): CommitDetails {
  return {
    added: commit.added,
    id: commit.id,
    modified: commit.modified,
    renamed: commit.renamed || [],
    removed: commit.removed,
  };
}

async function fetchCommitDetail(
  event: NormalizedPushEvent,
  commit: NormalizedCommit,
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<CommitDetails> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `https://api.github.com/repos/${event.repository.fullName}/commits/${commit.id}`,
    {
      headers: {
        ...githubHeaders(token),
      },
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}.`);
  }

  const data = (await response.json()) as GitHubCommitResponse;
  const files = groupCommitFiles(data.files || []);

  return {
    ...files,
    id: commit.id,
    stats: data.stats
      ? {
          additions: data.stats.additions || 0,
          deletions: data.stats.deletions || 0,
          total: data.stats.total || 0,
        }
      : undefined,
  };
}

async function fetchCompareEnrichment(
  event: NormalizedPushEvent,
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options: { warnOnFailure?: boolean } = {},
): Promise<Omit<PushEnrichment, "commitDetails"> | undefined> {
  if (!canCompare(event)) {
    return undefined;
  }

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `https://api.github.com/repos/${event.repository.fullName}/compare/${event.before}...${event.after}`,
      {
        headers: {
          ...githubHeaders(token),
        },
      },
      timeoutMs,
    );

    if (!response.ok) {
      throw new Error(`GitHub compare API returned ${response.status}.`);
    }

    const data = (await response.json()) as GitHubCompareResponse;
    const files = data.files || [];
    const fileGroups = groupCommitFiles(files);
    const stats = statsFromFiles(files);
    const fileCountCapped = files.length >= GITHUB_COMPARE_FILE_LIMIT;
    const enrichmentNotes: string[] = [];

    if (fileCountCapped) {
      enrichmentNotes.push(
        `GitHub compare file lists may be capped at ${GITHUB_COMPARE_FILE_LIMIT} files.`,
      );
    }

    return {
      enrichmentNotes,
      fileCount: totalFileCount(fileGroups),
      fileCountCapped,
      fileGroups,
      stats,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.warnOnFailure) {
      warn(`Could not fetch compare details. Falling back to commit details. ${message}`);
    }
    return undefined;
  }
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "User-Agent": "DaisyCatTs-DaisyTracker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function groupCommitFiles(
  files: NonNullable<GitHubCommitResponse["files"]>,
): Required<CommitFileGroups> {
  const groups: Required<CommitFileGroups> = {
    added: [],
    modified: [],
    renamed: [],
    removed: [],
  };

  for (const file of files) {
    if (!file.filename) {
      continue;
    }

    if (file.status === "added") {
      groups.added.push(file.filename);
    } else if (file.status === "removed") {
      groups.removed.push(file.filename);
    } else if (file.status === "renamed") {
      groups.renamed.push(
        file.previous_filename ? `${file.previous_filename} -> ${file.filename}` : file.filename,
      );
    } else {
      groups.modified.push(file.filename);
    }
  }

  return groups;
}

function enrichmentFromDetails(
  commitDetails: CommitDetails[],
  fileDetails: CommitDetails[],
): PushEnrichment {
  const fileGroups = aggregateFileGroups(fileDetails);
  const stats = aggregateStats(fileDetails);

  return {
    commitDetails,
    enrichmentNotes: [],
    fileCount: totalFileCount(fileGroups),
    fileCountCapped: false,
    fileGroups,
    stats,
  };
}

function hasFileDetails(details: CommitDetails[]): boolean {
  return details.some(
    (detail) =>
      detail.added.length > 0 ||
      detail.modified.length > 0 ||
      (detail.renamed || []).length > 0 ||
      detail.removed.length > 0,
  );
}

function aggregateFileGroups(details: CommitDetails[]): Required<CommitFileGroups> {
  const added = new Set<string>();
  const modified = new Set<string>();
  const renamed = new Set<string>();
  const removed = new Set<string>();

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
  }

  return {
    added: [...added].sort(),
    modified: [...modified].sort(),
    renamed: [...renamed].sort(),
    removed: [...removed].sort(),
  };
}

function aggregateStats(details: CommitDetails[]): CommitStats | undefined {
  let additions = 0;
  let deletions = 0;
  let total = 0;
  let hasStats = false;

  for (const detail of details) {
    if (!detail.stats) {
      continue;
    }

    hasStats = true;
    additions += detail.stats.additions;
    deletions += detail.stats.deletions;
    total += detail.stats.total;
  }

  return hasStats ? { additions, deletions, total } : undefined;
}

function statsFromFiles(
  files: NonNullable<GitHubCommitResponse["files"]>,
): CommitStats | undefined {
  if (files.length === 0) {
    return undefined;
  }

  let additions = 0;
  let deletions = 0;
  let total = 0;
  let hasStats = false;

  for (const file of files) {
    if (
      typeof file.additions === "number" ||
      typeof file.deletions === "number" ||
      typeof file.changes === "number"
    ) {
      hasStats = true;
      additions += file.additions || 0;
      deletions += file.deletions || 0;
      total += file.changes || (file.additions || 0) + (file.deletions || 0);
    }
  }

  return hasStats ? { additions, deletions, total } : undefined;
}

function totalFileCount(groups: Required<CommitFileGroups>): number {
  return (
    groups.added.length + groups.modified.length + groups.renamed.length + groups.removed.length
  );
}

function canCompare(event: NormalizedPushEvent): boolean {
  return Boolean(
    event.before && event.after && !isZeroSha(event.before) && !isZeroSha(event.after),
  );
}

function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        const item = items[currentIndex];
        if (item !== undefined) {
          results[currentIndex] = await mapper(item);
        }
      }
    }),
  );

  return results;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GitHub API request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 7) || "unknown";
}
