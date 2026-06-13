import { warn } from "./log";
import type {
  CommitDetails,
  CommitFileGroups,
  NormalizedCommit,
  NormalizedPushEvent,
} from "./types";

interface FetchCommitDetailsOptions {
  fetch?: typeof fetch;
  maxCommits: number;
  token: string;
}

interface GitHubCommitResponse {
  files?: Array<{
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

export async function fetchCommitDetails(
  event: NormalizedPushEvent,
  options: FetchCommitDetailsOptions,
): Promise<CommitDetails[]> {
  const commits = event.commits.slice(-options.maxCommits);

  if (!options.token) {
    return commits.map(commitDetailsFromPayload);
  }

  return Promise.all(
    commits.map(async (commit) => {
      try {
        return await fetchCommitDetail(
          event,
          commit,
          options.token,
          options.fetch || globalThis.fetch,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(
          `Could not fetch commit details for ${shortSha(commit.id)}. Using webhook payload data. ${message}`,
        );
        return commitDetailsFromPayload(commit);
      }
    }),
  );
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
): Promise<CommitDetails> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${event.repository.fullName}/commits/${commit.id}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "DaisyCatTs-DaisyTracker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
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

function groupCommitFiles(files: NonNullable<GitHubCommitResponse["files"]>): CommitFileGroups {
  const groups: CommitFileGroups = {
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
      groups.renamed?.push(
        file.previous_filename ? `${file.previous_filename} -> ${file.filename}` : file.filename,
      );
    } else {
      groups.modified.push(file.filename);
    }
  }

  return groups;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7) || "unknown";
}
