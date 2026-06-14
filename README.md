# DaisyTracker

DaisyTracker is a minimal GitHub Action that sends polished push summaries to Discord.
It is built for the normal workflow: add one Discord webhook secret, add one Action
step, and get useful commit updates without Renovate or Dependabot spam.

## Quick Start

Create a repository secret named `DISCORD_WEBHOOK_URL`, then add:

```yaml
name: DaisyTracker

on:
  push:
    branches:
      - main
      - master

jobs:
  notify:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: DaisyCatTs/DaisyTracker@v2
        with:
          discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

That is the recommended setup. No bot token, hosted server, dashboard, database, or
extra Discord application is required. Keep `contents: read`; DaisyTracker uses the
default `${{ github.token }}` to enrich file, language, rename, and line-change details
for private repositories.

## What It Sends

DaisyTracker sends a compact Discord dashboard for push events:

- repository and branch
- branch and tag creation/deletion summaries
- force-push notes
- commit count and recent commit links
- changed file count
- line-change stats when GitHub API access allows it
- dominant changed language
- added, modified, renamed, and removed file sections
- link to the compare view and workflow run

Discord limits are enforced before sending, including field length, field count, and
the 6000 character total embed limit.

## Release Scope

DaisyTracker v2 is intentionally focused on push notifications. Pull request, release,
star, and issue notifications are out of scope for v2 so the push path can stay fast,
predictable, and easy to trust. Unsupported events are skipped successfully.

## Example Output

Local preview renders the same JSON payload shape that the Action sends to Discord:

```json
[
  {
    "allowed_mentions": { "parse": [] },
    "embeds": [
      {
        "title": "Push delivered",
        "description": "**1** commit landed in DaisyCatTs/DaisyTracker on `branch:master`.",
        "fields": [
          { "name": "Repository", "value": "DaisyCatTs/DaisyTracker", "inline": true },
          { "name": "Ref", "value": "`branch:master`", "inline": true },
          { "name": "Commits", "value": "1", "inline": true },
          { "name": "Files", "value": "3", "inline": true },
          { "name": "Lines", "value": "+120 / -20 (140)", "inline": true },
          { "name": "Language", "value": "TypeScript", "inline": true }
        ]
      }
    ],
    "username": "DaisyTracker"
  }
]
```

## Language Detection And Icons

DaisyTracker detects the dominant changed language from GitHub Linguist-style file
extensions and common filenames. Supported detection includes TypeScript, JavaScript,
Python, Java, C#, C++, Go, Rust, Ruby, PHP, HTML, CSS, Markdown, Swift, Kotlin, Lua,
Shell, Dockerfile, YAML, JSON, Terraform, Svelte, Vue, Astro, Elixir, Erlang,
Haskell, Julia, Nix, PowerShell, SQL, Zig, and more.

The embed color follows the detected language when `color` is `auto`. Local PNG icons
are included for the languages that have curated assets in `assets/languages`. If a
detected language does not have a curated icon, DaisyTracker still uses the language
color and falls back to the repository avatar instead of sending a broken image.

Language data is generated from the vendored GitHub Linguist language map. The curated
icon list is intentionally smaller than the detection list, and new icon files should
document their source and license before release.

## Dependency Update Noise

Dependency automation can be noisy because Renovate and Dependabot push branches just
like humans do. DaisyTracker skips these updates by default.

Default ignored actors:

```text
dependabot[bot],renovate[bot],github-actions[bot]
```

Default ignored branches:

```text
renovate/**,dependabot/**
```

To send one small summary instead of silence:

```yaml
- uses: DaisyCatTs/DaisyTracker@v2
  with:
    discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    dependency-updates: compact
```

To send dependency updates like any other push:

```yaml
- uses: DaisyCatTs/DaisyTracker@v2
  with:
    discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    dependency-updates: full
```

You can also skip at the workflow level:

```yaml
if: github.actor != 'dependabot[bot]' && github.actor != 'renovate[bot]'
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `discord-webhook-url` | `DISCORD_WEBHOOK_URL` env | Discord webhook URL. Recommended value is `${{ secrets.DISCORD_WEBHOOK_URL }}`. |
| `github-token` | `${{ github.token }}` | Token for private repository file, language, rename, and line-change enrichment. |
| `title` | event-specific title | Custom embed title. |
| `color` | `auto` | Embed color as `auto`, `#rrggbb`, `0xrrggbb`, or decimal. `auto` uses the dominant changed language. |
| `username` | `DaisyTracker` | Discord webhook username override. |
| `avatar-url` | empty | Discord webhook avatar URL override. |
| `thread-id` | empty | Existing Discord thread ID to send into. |
| `thread-name` | empty | Thread name to create when the webhook belongs to a forum or media channel. |
| `fail-on-error` | `true` | Whether Discord or GitHub API errors fail the workflow. Set to `false` to warn only. |
| `suppress-mentions` | `true` | Sends `allowed_mentions: { parse: [] }` so commit text cannot ping users, roles, everyone, or here. |
| `dependency-updates` | `silent` | `silent`, `compact`, or `full`. |
| `ignored-actors` | `dependabot[bot],renovate[bot],github-actions[bot]` | Comma-separated bot actors to suppress. |
| `ignored-branches` | `renovate/**,dependabot/**` | Comma-separated branch globs to suppress. |
| `max-commits` | `10` | Maximum recent commits shown. |
| `max-files-per-section` | `10` | Maximum files shown in each added, modified, renamed, and removed section. |
| `max-messages` | `5` | Maximum Discord webhook messages sent for one push before truncating output. |
| `send-on-events` | `push` | Comma-separated event names. Only `push` is currently sent. |

## GitHub Token

The quick start already uses GitHub's default `${{ github.token }}` through the action
metadata, so private repositories work without adding another secret. Keep:

```yaml
permissions:
  contents: read
```

For public repositories, DaisyTracker can also fall back to GitHub's public commit and
compare APIs if the push payload does not include changed-file details.

Override `github-token` only when you want to use a PAT or a GitHub App token:

```yaml
- uses: DaisyCatTs/DaisyTracker@v2
  with:
    discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    github-token: ${{ secrets.MY_GITHUB_TOKEN }}
```

## Discord Threads

Send into an existing thread:

```yaml
- uses: DaisyCatTs/DaisyTracker@v2
  with:
    discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    thread-id: "123456789012345678"
```

Create a thread in a forum or media channel webhook:

```yaml
- uses: DaisyCatTs/DaisyTracker@v2
  with:
    discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    thread-name: "deploys"
```

## Failure Policy

By default, webhook delivery errors fail the workflow after retries. For repositories
where Discord notification delivery should never block CI, set:

```yaml
- uses: DaisyCatTs/DaisyTracker@v2
  with:
    discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    fail-on-error: false
```

Configuration and internal payload errors always fail, even when `fail-on-error` is
`false`. That includes a missing or invalid webhook URL, unreadable GitHub event JSON,
and rendered payloads that fail Discord limit validation.

## Local Development

This repo uses TypeScript and Bun.

```bash
bun install
bun run languages:check
bun run check
bun run build
```

Preview an embed payload from a fixture:

```bash
bun run preview tests/fixtures/push.single.json
```

The source is split by responsibility under `src/`. The generated Action bundle is
`dist/index.js` and is committed so users do not need to install dependencies when the
Action runs.

`node_modules` is intentionally not committed. The only runtime file required by the
GitHub Action is the generated `dist/index.js` bundle.

## Troubleshooting

`Missing Discord webhook URL`

Set the `discord-webhook-url` input or the `DISCORD_WEBHOOK_URL` environment variable.

`Discord webhook request failed with 400`

The webhook URL is valid, but Discord rejected the payload. Open an issue with the
workflow event shape if this happens; DaisyTracker validates known embed limits before
sending.

`Discord webhook request failed with 429`

Discord rate-limited the webhook. DaisyTracker retries 429 responses automatically, but
very busy repositories may still need fewer notification triggers.

Unsupported events

DaisyTracker currently sends push events. Unsupported events are skipped successfully
instead of failing the workflow.

## Migrating From Older Forks

Older examples may use `snowypy/Gitracker@master` or `snowyjs/Gitracker@master` and
pass values through `env`. For this fork, use `DaisyCatTs/DaisyTracker@v2` and prefer the
`discord-webhook-url` input shown above. The old `DISCORD_WEBHOOK_URL` environment
fallback still works for compatibility.

## License

DaisyTracker is licensed under `GPL-3.0-only`. The SPDX value in `package.json` matches
the full license text in `LICENSE`.
