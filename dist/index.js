"use strict";

// src/log.ts
function info(message) {
  console.log(message);
}
function warn(message) {
  console.warn(`::warning::${escapeCommandData(message)}`);
}
function mask(value) {
  if (value) {
    console.log(`::add-mask::${escapeCommandData(value)}`);
  }
}
function error(message) {
  console.error(`::error::${escapeCommandData(message)}`);
}
function escapeCommandData(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

// src/config.ts
var DEFAULT_IGNORED_ACTORS = ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"];
var DEFAULT_IGNORED_BRANCHES = ["renovate/**", "dependabot/**"];
function readActionConfig(env = process.env) {
  return {
    avatarUrl: getInput("avatar-url", env),
    color: parseOptionalColor(getInput("color", env)),
    dependencyUpdates: parseDependencyUpdateMode(getInput("dependency-updates", env) || "silent"),
    discordWebhookUrl: getInput("discord-webhook-url", env) || env.DISCORD_WEBHOOK_URL || "",
    failOnError: parseBoolean(getInput("fail-on-error", env), true),
    githubToken: getInput("github-token", env) || env.GITHUB_TOKEN || "",
    ignoredActors: parseCsv(getInput("ignored-actors", env), DEFAULT_IGNORED_ACTORS),
    ignoredBranches: parseCsv(getInput("ignored-branches", env), DEFAULT_IGNORED_BRANCHES),
    maxCommits: parsePositiveInteger(getInput("max-commits", env), 10, 1, 50),
    maxFilesPerSection: parsePositiveInteger(getInput("max-files-per-section", env), 10, 0, 50),
    sendOnEvents: parseCsv(getInput("send-on-events", env), ["push"]).map(
      (event) => event.toLowerCase()
    ),
    suppressMentions: parseBoolean(getInput("suppress-mentions", env), true),
    threadId: getInput("thread-id", env),
    threadName: getInput("thread-name", env),
    title: getInput("title", env),
    username: getInput("username", env) || "DaisyTracker"
  };
}
function getInput(name, env = process.env) {
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
function shouldFailOnError(env = process.env) {
  return parseBoolean(getInput("fail-on-error", env), true);
}
function parseCsv(value, fallback) {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}
function parsePositiveInteger(value, fallback, minimum, maximum) {
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
function parseBoolean(value, fallback) {
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
function parseDependencyUpdateMode(value) {
  const normalized = value.toLowerCase();
  if (normalized === "compact" || normalized === "full" || normalized === "silent") {
    return normalized;
  }
  warn(`Invalid dependency-updates value "${value}". Falling back to "silent".`);
  return "silent";
}
function parseOptionalColor(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") {
    return void 0;
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(1), 16);
  }
  if (/^0x[0-9a-f]{6}$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(2), 16);
  }
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number.parseInt(trimmed, 10), 16777215);
  }
  warn(`Invalid color value "${value}". Falling back to automatic language color.`);
  return void 0;
}

// src/discord-limits.ts
var DISCORD_LIMITS = {
  authorName: 256,
  content: 2e3,
  description: 4096,
  embedText: 6e3,
  embeds: 10,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footerText: 2048,
  title: 256,
  username: 80
};
function validateDiscordWebhookPayload(payload2) {
  if (payload2.username && payload2.username.length > DISCORD_LIMITS.username) {
    throw new Error(`Discord webhook username exceeds ${DISCORD_LIMITS.username} characters.`);
  }
  if (!payload2.embeds.length) {
    throw new Error("Discord webhook payload must contain at least one embed.");
  }
  if (payload2.embeds.length > DISCORD_LIMITS.embeds) {
    throw new Error(`Discord webhook payload exceeds ${DISCORD_LIMITS.embeds} embeds.`);
  }
  const total = payload2.embeds.reduce((sum, embed) => sum + validateEmbed(embed), 0);
  if (total > DISCORD_LIMITS.embedText) {
    throw new Error(`Discord webhook embed text exceeds ${DISCORD_LIMITS.embedText} characters.`);
  }
}
function normalizeEmbed(embed) {
  const fields = (embed.fields || []).slice(0, DISCORD_LIMITS.fields).map((field) => ({
    inline: Boolean(field.inline),
    name: truncate(field.name || "Field", DISCORD_LIMITS.fieldName),
    value: truncate(field.value || "_No content_", DISCORD_LIMITS.fieldValue)
  }));
  const normalized = {
    ...embed,
    author: embed.author?.name ? {
      ...embed.author,
      name: truncate(embed.author.name, DISCORD_LIMITS.authorName)
    } : embed.author,
    description: embed.description ? truncate(embed.description, DISCORD_LIMITS.description) : void 0,
    fields,
    footer: embed.footer?.text ? {
      ...embed.footer,
      text: truncate(embed.footer.text, DISCORD_LIMITS.footerText)
    } : embed.footer,
    title: embed.title ? truncate(embed.title, DISCORD_LIMITS.title) : void 0
  };
  while (embedTextLength(normalized) > DISCORD_LIMITS.embedText && normalized.fields?.length) {
    normalized.fields.pop();
  }
  if (embedTextLength(normalized) > DISCORD_LIMITS.embedText && normalized.description) {
    normalized.description = truncate(
      normalized.description,
      Math.max(
        0,
        DISCORD_LIMITS.description - (embedTextLength(normalized) - DISCORD_LIMITS.embedText) - 16
      )
    );
  }
  return normalized;
}
function canAddField(embed, field) {
  const next = {
    ...embed,
    fields: [...embed.fields || [], field]
  };
  return (next.fields?.length || 0) <= DISCORD_LIMITS.fields && embedTextLength(next) <= DISCORD_LIMITS.embedText;
}
function embedTextLength(embed) {
  return [
    embed.title || "",
    embed.description || "",
    embed.footer?.text || "",
    embed.author?.name || "",
    ...(embed.fields || []).flatMap((field) => [field.name || "", field.value || ""])
  ].reduce((total, value) => total + value.length, 0);
}
function appendFooterNote(embed, note) {
  const existing = embed.footer?.text || "";
  embed.footer = {
    ...embed.footer || {},
    text: truncate(existing ? `${existing} | ${note}` : note, DISCORD_LIMITS.footerText)
  };
}
function truncate(value, limit) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}
function validateEmbed(embed) {
  if (embed.title && embed.title.length > DISCORD_LIMITS.title) {
    throw new Error(`Discord embed title exceeds ${DISCORD_LIMITS.title} characters.`);
  }
  if (embed.description && embed.description.length > DISCORD_LIMITS.description) {
    throw new Error(`Discord embed description exceeds ${DISCORD_LIMITS.description} characters.`);
  }
  if (embed.author?.name && embed.author.name.length > DISCORD_LIMITS.authorName) {
    throw new Error(`Discord embed author exceeds ${DISCORD_LIMITS.authorName} characters.`);
  }
  if (embed.footer?.text && embed.footer.text.length > DISCORD_LIMITS.footerText) {
    throw new Error(`Discord embed footer exceeds ${DISCORD_LIMITS.footerText} characters.`);
  }
  if ((embed.fields || []).length > DISCORD_LIMITS.fields) {
    throw new Error(`Discord embed exceeds ${DISCORD_LIMITS.fields} fields.`);
  }
  for (const field of embed.fields || []) {
    if (!field.name || !field.value) {
      throw new Error("Discord embed fields must include non-empty name and value.");
    }
    if (field.name.length > DISCORD_LIMITS.fieldName) {
      throw new Error(`Discord embed field name exceeds ${DISCORD_LIMITS.fieldName} characters.`);
    }
    if (field.value.length > DISCORD_LIMITS.fieldValue) {
      throw new Error(`Discord embed field value exceeds ${DISCORD_LIMITS.fieldValue} characters.`);
    }
  }
  return embedTextLength(embed);
}

// src/discord.ts
var DEFAULT_MAX_ATTEMPTS = 3;
async function sendDiscordPayloads(webhookUrl, payloads, options = {}) {
  validateWebhookUrl(webhookUrl);
  for (const payload2 of payloads) {
    validateDiscordWebhookPayload(payload2);
    await sendWithRetry(webhookUrl, payload2, options);
  }
}
async function sendWithRetry(webhookUrl, payload2, options) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const sleep = options.sleep || defaultSleep;
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const url = webhookExecuteUrl(webhookUrl, options.threadId);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      body: JSON.stringify(payload2),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "DaisyCatTs-DaisyTracker"
      },
      method: "POST"
    });
    if (response.ok) {
      return;
    }
    if (isConfigurationError(response.status)) {
      throw new Error(await webhookErrorMessage(webhookUrl, response));
    }
    if (attempt < maxAttempts && shouldRetry(response.status)) {
      await sleep(await retryDelay(response));
      continue;
    }
    throw new Error(await webhookErrorMessage(webhookUrl, response));
  }
}
function validateWebhookUrl(webhookUrl) {
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("Discord webhook URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Discord webhook URL must use https.");
  }
}
function shouldRetry(status) {
  return status === 429 || status >= 500;
}
function isConfigurationError(status) {
  return status === 401 || status === 403 || status === 404;
}
async function retryDelay(response) {
  const headerDelay = response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset-after");
  if (headerDelay) {
    return Math.min(Number.parseFloat(headerDelay) * 1e3, 1e4);
  }
  if (response.status === 429) {
    try {
      const body = await response.clone().json();
      if (typeof body.retry_after === "number") {
        return Math.min(body.retry_after * 1e3, 1e4);
      }
    } catch {
      return 1e3;
    }
  }
  return 1e3;
}
async function webhookErrorMessage(webhookUrl, response) {
  return `Discord webhook request failed with ${response.status} for ${redactWebhookUrl(
    webhookUrl
  )}: ${await responseSnippet(response)}`;
}
async function responseSnippet(response) {
  try {
    return (await response.text()).slice(0, 500) || response.statusText;
  } catch {
    return response.statusText;
  }
}
function redactWebhookUrl(webhookUrl) {
  return webhookUrl.replace(/(\/api\/webhooks\/\d+\/)[^/?]+/i, "$1***");
}
function webhookExecuteUrl(webhookUrl, threadId) {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  if (threadId) {
    url.searchParams.set("thread_id", threadId);
  }
  return url.toString();
}
function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// src/language-data.ts
var LANGUAGE_BY_EXTENSION = {
  astro: { color: 16734723, name: "Astro" },
  bash: { color: 9035857, name: "Shell" },
  bat: { color: 12710190, name: "Batchfile" },
  c: { color: 5592405, name: "C" },
  cc: { color: 15944573, icon: "cpp", name: "C++" },
  clj: { color: 14374997, name: "Clojure" },
  cljs: { color: 14374997, name: "Clojure" },
  cmake: { color: 14300212, name: "CMake" },
  coffee: { color: 2377590, name: "CoffeeScript" },
  cpp: { color: 15944573, icon: "cpp", name: "C++" },
  cs: { color: 1541632, icon: "csharp", name: "C#" },
  css: { color: 6697881, icon: "css", name: "CSS" },
  dart: { color: 46251, name: "Dart" },
  dockerfile: { color: 3689812, name: "Dockerfile" },
  eex: { color: 7228030, name: "Elixir" },
  elm: { color: 6337996, name: "Elm" },
  erl: { color: 12073368, name: "Erlang" },
  ex: { color: 7228030, name: "Elixir" },
  exs: { color: 7228030, name: "Elixir" },
  fs: { color: 12076540, name: "F#" },
  fsx: { color: 12076540, name: "F#" },
  gd: { color: 3495280, name: "GDScript" },
  go: { color: 44504, icon: "go", name: "Go" },
  gql: { color: 14745752, name: "GraphQL" },
  graphql: { color: 14745752, name: "GraphQL" },
  groovy: { color: 4364472, name: "Groovy" },
  h: { color: 11057612, name: "C/C++ Header" },
  hcl: { color: 8671162, name: "HCL" },
  heex: { color: 7228030, name: "Elixir" },
  hpp: { color: 15944573, icon: "cpp", name: "C++" },
  hs: { color: 6180998, name: "Haskell" },
  htm: { color: 14896166, icon: "html", name: "HTML" },
  html: { color: 14896166, icon: "html", name: "HTML" },
  java: { color: 11563545, icon: "java", name: "Java" },
  jl: { color: 10645690, name: "Julia" },
  js: { color: 15851610, icon: "javascript", name: "JavaScript" },
  json: { color: 2697513, name: "JSON" },
  json5: { color: 2522297, name: "JSON5" },
  jsonc: { color: 2697513, name: "JSON with Comments" },
  jsx: { color: 15851610, icon: "javascript", name: "JavaScript" },
  kt: { color: 11107327, icon: "kotlin", name: "Kotlin" },
  kts: { color: 11107327, icon: "kotlin", name: "Kotlin" },
  less: { color: 1914461, name: "Less" },
  liquid: { color: 6797534, name: "Liquid" },
  lua: { color: 128, icon: "lua", name: "Lua" },
  m: { color: 4427519, name: "Objective-C" },
  md: { color: 540577, icon: "markdown", name: "Markdown" },
  mjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  mm: { color: 4427519, name: "Objective-C++" },
  nim: { color: 16761344, name: "Nim" },
  nix: { color: 8290047, name: "Nix" },
  php: { color: 5201301, icon: "php", name: "PHP" },
  pl: { color: 170179, name: "Perl" },
  pm: { color: 170179, name: "Perl" },
  ps1: { color: 74838, name: "PowerShell" },
  psm1: { color: 74838, name: "PowerShell" },
  pug: { color: 11035732, name: "Pug" },
  py: { color: 3502757, icon: "python", name: "Python" },
  r: { color: 1674471, name: "R" },
  rb: { color: 7345430, icon: "ruby", name: "Ruby" },
  res: { color: 15552593, name: "ReScript" },
  rs: { color: 14591364, icon: "rust", name: "Rust" },
  sass: { color: 10828656, name: "Sass" },
  scala: { color: 12725568, name: "Scala" },
  scss: { color: 12997516, name: "SCSS" },
  sh: { color: 9035857, name: "Shell" },
  sql: { color: 14912512, name: "SQL" },
  svelte: { color: 16727552, name: "Svelte" },
  swift: { color: 15749432, icon: "swift", name: "Swift" },
  tf: { color: 8671162, name: "Terraform" },
  toml: { color: 10240545, name: "TOML" },
  ts: { color: 3242182, icon: "typescript", name: "TypeScript" },
  tsx: { color: 3242182, icon: "typescript", name: "TypeScript" },
  vue: { color: 4307075, name: "Vue" },
  xml: { color: 24748, name: "XML" },
  yaml: { color: 13309726, name: "YAML" },
  yml: { color: 13309726, name: "YAML" },
  zig: { color: 15503708, name: "Zig" },
  zsh: { color: 9035857, name: "Shell" }
};
var LANGUAGE_BY_FILENAME = {
  ".babelrc": { color: 15851610, icon: "javascript", name: "JavaScript" },
  ".dockerignore": { color: 3689812, name: "Dockerfile" },
  ".eslintrc": { color: 4928195, name: "ESLint" },
  ".gitattributes": { color: 16010535, name: "Git Attributes" },
  ".gitignore": { color: 16010535, name: "Git Ignore" },
  ".prettierrc": { color: 1714996, name: "Prettier" },
  "bun.lock": { color: 16380385, name: "Bun" },
  "cargo.lock": { color: 14591364, icon: "rust", name: "Rust" },
  "cargo.toml": { color: 14591364, icon: "rust", name: "Rust" },
  "cmakelists.txt": { color: 14300212, name: "CMake" },
  "composer.json": { color: 5201301, icon: "php", name: "PHP" },
  dockerfile: { color: 3689812, name: "Dockerfile" },
  gemfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "go.mod": { color: 44504, icon: "go", name: "Go" },
  "go.sum": { color: 44504, icon: "go", name: "Go" },
  makefile: { color: 4356121, name: "Makefile" },
  "package-lock.json": { color: 15851610, icon: "javascript", name: "JavaScript" },
  "package.json": { color: 15851610, icon: "javascript", name: "JavaScript" },
  "pnpm-lock.yaml": { color: 16159264, name: "PNPM" },
  "pom.xml": { color: 11563545, icon: "java", name: "Java" },
  procfile: { color: 6775462, name: "Procfile" },
  "pyproject.toml": { color: 3502757, icon: "python", name: "Python" },
  "requirements.txt": { color: 3502757, icon: "python", name: "Python" },
  "tsconfig.json": { color: 3242182, icon: "typescript", name: "TypeScript" },
  "yarn.lock": { color: 2920123, name: "Yarn" }
};

// src/languages.ts
var UNKNOWN_LANGUAGE = {
  color: 5793266,
  name: "Mixed"
};
function detectDominantLanguage(files) {
  const counts = /* @__PURE__ */ new Map();
  for (const file of files) {
    const language = detectLanguage(file);
    if (!language) {
      continue;
    }
    const existing = counts.get(language.name);
    counts.set(language.name, {
      count: (existing?.count || 0) + 1,
      language
    });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.language || UNKNOWN_LANGUAGE;
}
function detectLanguage(file) {
  const normalized = basename(file).toLowerCase();
  const fileMatch = LANGUAGE_BY_FILENAME[normalized];
  if (fileMatch) {
    return fileMatch;
  }
  const extension = normalized.includes(".") ? normalized.split(".").pop() || "" : "";
  return LANGUAGE_BY_EXTENSION[extension];
}
function languageIconUrl(language) {
  if (!language.icon) {
    return void 0;
  }
  return `https://raw.githubusercontent.com/DaisyCatTs/DaisyTracker/master/assets/languages/${language.icon}.png`;
}
function basename(file) {
  return file.split(/[\\/]/).pop() || file;
}

// src/embed.ts
var MAX_PAYLOADS = 5;
function buildPushPayloads(event, details, config) {
  const changes = aggregateChanges(details);
  const language = detectDominantLanguage([
    ...changes.added,
    ...changes.modified,
    ...changes.renamed,
    ...changes.removed
  ]);
  const latestCommit = event.headCommit || event.commits.at(-1);
  const thumbnailUrl = languageIconUrl(language) || event.repository.avatarUrl;
  const color = embedColor(config, language);
  const notes = eventNotes(event);
  const primaryEmbed = normalizeEmbed({
    author: {
      icon_url: event.sender?.avatarUrl || event.repository.avatarUrl,
      name: `${event.actor} ${eventVerb(event)} ${refLabel(event)}`,
      url: event.sender?.url || event.repository.url
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
        value: formatCommitList(event.commits, config.maxCommits)
      }
    ],
    footer: {
      text: footerText(event, latestCommit)
    },
    thumbnail: thumbnailUrl ? { url: thumbnailUrl } : void 0,
    timestamp: latestCommit?.timestamp ? new Date(latestCommit.timestamp).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
    title: config.title || titleForPush(event),
    url: event.compareUrl || event.repository.url
  });
  if (notes.length > 0) {
    primaryEmbed.fields = [
      ...primaryEmbed.fields || [],
      {
        inline: false,
        name: "Notes",
        value: notes.join("\n")
      }
    ];
  }
  const overflowFields = [];
  for (const field of [
    ...fileFields("Added files", changes.added, config.maxFilesPerSection),
    ...fileFields("Modified files", changes.modified, config.maxFilesPerSection),
    ...fileFields("Renamed files", changes.renamed, config.maxFilesPerSection),
    ...fileFields("Removed files", changes.removed, config.maxFilesPerSection)
  ]) {
    if (canAddField(primaryEmbed, field)) {
      primaryEmbed.fields = [...primaryEmbed.fields || [], field];
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
        text: footerText(event, latestCommit)
      },
      title: field.name,
      url: event.compareUrl || event.repository.url
    });
    payloads.push(payload(embed, config));
  }
  return capPayloads(payloads);
}
function buildCompactDependencyPayload(event, config, reason) {
  const latestCommit = event.headCommit || event.commits.at(-1);
  const language = detectDominantLanguage(event.commits.flatMap(commitFileNames));
  const embed = normalizeEmbed({
    color: embedColor(config, language),
    description: "A dependency automation update was detected. DaisyTracker is configured to avoid noisy full notifications for these updates.",
    fields: [
      inlineField("Repository", markdownLink(event.repository.fullName, event.repository.url)),
      inlineField("Ref", code(refLabel(event))),
      inlineField("Actor", code(event.actor)),
      inlineField("Commits", String(event.commits.length)),
      inlineField("Reason", reason || "dependency update"),
      {
        inline: false,
        name: "Latest commit",
        value: latestCommit ? formatCommit(latestCommit) : "_No commit available_"
      }
    ],
    footer: {
      text: footerText(event, latestCommit)
    },
    timestamp: latestCommit?.timestamp ? new Date(latestCommit.timestamp).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
    title: "Dependency update summarized",
    url: event.compareUrl || event.repository.url
  });
  return payload(embed, config);
}
function buildRefDeletedPayload(event, config) {
  const embed = normalizeEmbed({
    author: {
      icon_url: event.sender?.avatarUrl || event.repository.avatarUrl,
      name: `${event.actor} deleted ${refLabel(event)}`,
      url: event.sender?.url || event.repository.url
    },
    color: config.color ?? 14300723,
    description: `${markdownLink(event.repository.fullName, event.repository.url)} had ${code(
      refLabel(event)
    )} deleted.`,
    fields: [
      inlineField("Repository", markdownLink(event.repository.fullName, event.repository.url)),
      inlineField("Ref", code(refLabel(event))),
      inlineField("Previous", code(shortSha(event.before)))
    ],
    footer: {
      text: footerText(event)
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    title: config.title || "GitHub ref deleted",
    url: event.repository.url
  });
  return payload(embed, config);
}
function payload(embed, config) {
  return {
    allowed_mentions: config.suppressMentions ? { parse: [] } : void 0,
    avatar_url: config.avatarUrl || void 0,
    embeds: [embed],
    thread_name: config.threadName || void 0,
    username: truncate(config.username || "DaisyTracker", DISCORD_LIMITS.username)
  };
}
function aggregateChanges(details) {
  const added = /* @__PURE__ */ new Set();
  const modified = /* @__PURE__ */ new Set();
  const renamed = /* @__PURE__ */ new Set();
  const removed = /* @__PURE__ */ new Set();
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
    additions: hasStats ? additions : void 0,
    deletions: hasStats ? deletions : void 0,
    modified: [...modified].sort(),
    renamed: [...renamed].sort(),
    removed: [...removed].sort(),
    total: hasStats ? total : void 0
  };
}
function buildDescription(event) {
  const commits = `**${event.commits.length}** commit${event.commits.length === 1 ? "" : "s"}`;
  const compare = event.compareUrl ? ` ${markdownLink("View comparison", event.compareUrl)}.` : "";
  return `${commits} landed in ${markdownLink(event.repository.fullName, event.repository.url)} on ${code(
    refLabel(event)
  )}.${compare}`;
}
function eventNotes(event) {
  const notes = [];
  if (event.created) {
    notes.push("This push created the ref.");
  }
  if (event.forced) {
    notes.push("This was a force push.");
  }
  if (event.commitsCapped) {
    notes.push(
      "GitHub caps push payloads at 2048 commits; this summary may not include every commit."
    );
  }
  return notes;
}
function inlineField(name, value) {
  return { inline: true, name, value };
}
function fileFields(name, files, maxFiles) {
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
    value
  }));
}
function chunkLines(lines, limit) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}
${line}` : line;
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
function formatCommitList(commits, maxCommits) {
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
function formatCommit(commit) {
  const shortMessage = firstLine(commit.message);
  const shortId = shortSha(commit.id);
  const linkedSha = commit.url ? markdownLink(code(shortId), commit.url) : code(shortId);
  return `${linkedSha} ${truncate(shortMessage, 140)}`;
}
function capPayloads(payloads) {
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
function lineSummary(changes) {
  if (typeof changes.additions !== "number" || typeof changes.deletions !== "number" || typeof changes.total !== "number") {
    return "Unavailable";
  }
  return `+${changes.additions} / -${changes.deletions} (${changes.total})`;
}
function totalFileCount(changes) {
  return changes.added.length + changes.modified.length + changes.renamed.length + changes.removed.length;
}
function footerText(event, latestCommit) {
  const parts = [`Latest ${shortSha(latestCommit?.id || event.after || event.before)}`];
  if (event.runUrl) {
    parts.push(`Run: ${event.runUrl}`);
  }
  return parts.join(" | ");
}
function commitCountLabel(event) {
  return event.commitsCapped ? `${event.commits.length}+` : String(event.commits.length);
}
function titleForPush(event) {
  if (event.created) {
    return `GitHub ${event.refType} created`;
  }
  if (event.forced) {
    return "GitHub force push delivered";
  }
  return "GitHub push delivered";
}
function eventVerb(event) {
  if (event.created) {
    return "created";
  }
  if (event.forced) {
    return "force-pushed to";
  }
  return "pushed to";
}
function refLabel(event) {
  const type = event.refType === "unknown" ? "ref" : event.refType;
  return `${type}:${event.refName || "unknown"}`;
}
function embedColor(config, language) {
  return config.color ?? language.color;
}
function commitFileNames(commit) {
  return [...commit.added, ...commit.modified, ...commit.renamed || [], ...commit.removed];
}
function markdownLink(label, url) {
  return `[${label}](${url})`;
}
function code(value) {
  return `\`${value.replace(/`/g, "'")}\``;
}
function firstLine(value) {
  return value.split("\n")[0]?.trim() || "_No commit message_";
}
function shortSha(sha = "") {
  return sha.slice(0, 7) || "unknown";
}

// src/filter.ts
var DEPENDENCY_MESSAGE_PATTERNS = [
  /^build\(deps(?:-dev)?\):/i,
  /^chore\(deps(?:-dev)?\):/i,
  /^deps:/i,
  /^fix\(deps(?:-dev)?\):/i,
  /^update dependency /i,
  /^update .* dependencies/i,
  /^bump .+ from .+ to .+/i,
  /renovate/i,
  /dependabot/i
];
function shouldSkipDependencyUpdate(event, options) {
  const normalizedActor = event.actor.toLowerCase();
  const ignoredActor = options.ignoredActors.find(
    (actor) => actor.toLowerCase() === normalizedActor
  );
  if (ignoredActor) {
    return { reason: `actor ${ignoredActor}`, skip: true };
  }
  const ignoredBranch = options.ignoredBranches.find(
    (pattern) => globMatches(pattern, event.branch)
  );
  if (ignoredBranch) {
    return { reason: `branch ${event.branch} matched ${ignoredBranch}`, skip: true };
  }
  if (event.commits.length > 0 && event.commits.every((commit) => isDependencyUpdateMessage(commit.message))) {
    return { reason: "commit messages look like dependency updates", skip: true };
  }
  return { reason: "", skip: false };
}
function isDependencyUpdateMessage(message) {
  const firstLine2 = message.split("\n")[0]?.trim() || "";
  return DEPENDENCY_MESSAGE_PATTERNS.some((pattern) => pattern.test(firstLine2));
}
function globMatches(pattern, value) {
  const regex = new RegExp(`^${globToRegex(pattern)}$`, "i");
  return regex.test(value);
}
function globToRegex(pattern) {
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
function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

// src/github-event.ts
var import_promises = require("node:fs/promises");
var GITHUB_PUSH_COMMIT_PAYLOAD_LIMIT = 2048;
async function loadGitHubEvent(env = process.env) {
  const eventName = env.GITHUB_EVENT_NAME || "push";
  if (eventName !== "push") {
    return { eventName };
  }
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("Missing GITHUB_EVENT_PATH. DaisyTracker must run inside GitHub Actions.");
  }
  const payload2 = JSON.parse(await (0, import_promises.readFile)(eventPath, "utf8"));
  return normalizePushPayload(payload2, env);
}
function normalizePushPayload(payload2, env = process.env) {
  const repository = normalizeRepository(payload2.repository);
  const commits = (payload2.commits || []).map((commit) => normalizeCommit(commit));
  const headCommit = payload2.head_commit ? normalizeCommit(payload2.head_commit) : commits.at(-1);
  const actor = env.GITHUB_ACTOR || payload2.sender?.login || payload2.pusher?.name || "unknown";
  const ref = payload2.ref || env.GITHUB_REF || "";
  const refType = refTypeFromRef(ref);
  const refName = refNameFromRef(ref);
  const runUrl = env.GITHUB_RUN_ID ? `${repository.url}/actions/runs/${env.GITHUB_RUN_ID}` : void 0;
  return {
    actor,
    after: payload2.after || headCommit?.id || "",
    before: payload2.before || "",
    branch: refName,
    commits,
    commitsCapped: commits.length >= GITHUB_PUSH_COMMIT_PAYLOAD_LIMIT,
    compareUrl: payload2.compare,
    created: Boolean(payload2.created),
    deleted: Boolean(payload2.deleted),
    eventName: "push",
    forced: Boolean(payload2.forced),
    headCommit,
    ref,
    refName,
    refType,
    repository,
    runUrl,
    sender: normalizeSender(payload2.sender)
  };
}
function normalizeRepository(repository) {
  const fullName = repository?.full_name || "unknown/unknown";
  const [owner = "unknown", name = repository?.name || "unknown"] = fullName.split("/");
  return {
    avatarUrl: repository?.owner?.avatar_url,
    defaultBranch: repository?.default_branch,
    fullName,
    name,
    owner: repository?.owner?.login || repository?.owner?.name || owner,
    url: repository?.html_url || `https://github.com/${fullName}`
  };
}
function normalizeSender(sender) {
  if (!sender?.login) {
    return void 0;
  }
  return {
    avatarUrl: sender.avatar_url,
    login: sender.login,
    url: sender.html_url || `https://github.com/${sender.login}`
  };
}
function normalizeCommit(commit) {
  const authorName = commit.author?.name || commit.committer?.name || "Unknown author";
  const authorUsername = commit.author?.username || commit.committer?.username;
  return {
    ...fileGroupsFromCommit(commit),
    authorName,
    authorUsername,
    id: commit.id || "",
    message: commit.message || "",
    timestamp: commit.timestamp,
    url: commit.url || ""
  };
}
function fileGroupsFromCommit(commit) {
  return {
    added: commit.added || [],
    modified: commit.modified || [],
    removed: commit.removed || []
  };
}
function refNameFromRef(ref) {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}
function refTypeFromRef(ref) {
  if (ref.startsWith("refs/heads/")) {
    return "branch";
  }
  if (ref.startsWith("refs/tags/")) {
    return "tag";
  }
  return "unknown";
}

// src/github-api.ts
async function fetchCommitDetails(event, options) {
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
          options.fetch || globalThis.fetch
        );
      } catch (error2) {
        const message = error2 instanceof Error ? error2.message : String(error2);
        warn(
          `Could not fetch commit details for ${shortSha2(commit.id)}. Using webhook payload data. ${message}`
        );
        return commitDetailsFromPayload(commit);
      }
    })
  );
}
function commitDetailsFromPayload(commit) {
  return {
    added: commit.added,
    id: commit.id,
    modified: commit.modified,
    renamed: commit.renamed || [],
    removed: commit.removed
  };
}
async function fetchCommitDetail(event, commit, token, fetchImpl) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${event.repository.fullName}/commits/${commit.id}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "DaisyCatTs-DaisyTracker",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}.`);
  }
  const data = await response.json();
  const files = groupCommitFiles(data.files || []);
  return {
    ...files,
    id: commit.id,
    stats: data.stats ? {
      additions: data.stats.additions || 0,
      deletions: data.stats.deletions || 0,
      total: data.stats.total || 0
    } : void 0
  };
}
function groupCommitFiles(files) {
  const groups = {
    added: [],
    modified: [],
    renamed: [],
    removed: []
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
        file.previous_filename ? `${file.previous_filename} -> ${file.filename}` : file.filename
      );
    } else {
      groups.modified.push(file.filename);
    }
  }
  return groups;
}
function shortSha2(sha) {
  return sha.slice(0, 7) || "unknown";
}

// src/action.ts
async function run(env = process.env, fetchImpl = globalThis.fetch) {
  try {
    const config = readActionConfig(env);
    const eventName = env.GITHUB_EVENT_NAME || "push";
    const normalizedEventName = eventName.toLowerCase();
    if (!config.sendOnEvents.includes(normalizedEventName)) {
      info(`DaisyTracker skipped event "${eventName}" because send-on-events does not include it.`);
      return;
    }
    if (normalizedEventName !== "push") {
      info(`DaisyTracker currently supports push events. Event "${eventName}" was skipped.`);
      return;
    }
    if (!config.discordWebhookUrl) {
      throw new Error(
        "Missing Discord webhook URL. Set the discord-webhook-url input or DISCORD_WEBHOOK_URL."
      );
    }
    mask(config.discordWebhookUrl);
    if (config.githubToken) {
      mask(config.githubToken);
    }
    const event = await loadGitHubEvent(env);
    if (!isPushEvent(event)) {
      info(`DaisyTracker currently supports push events. Event "${event.eventName}" was skipped.`);
      return;
    }
    const dependencyDecision = shouldSkipDependencyUpdate(event, {
      ignoredActors: config.ignoredActors,
      ignoredBranches: config.ignoredBranches
    });
    if (dependencyDecision.skip && config.dependencyUpdates === "silent") {
      info(`DaisyTracker skipped dependency update noise: ${dependencyDecision.reason}.`);
      return;
    }
    if (dependencyDecision.skip && config.dependencyUpdates === "compact") {
      await sendDiscordPayloads(
        config.discordWebhookUrl,
        [buildCompactDependencyPayload(event, config, dependencyDecision.reason)],
        {
          fetch: fetchImpl,
          threadId: config.threadId
        }
      );
      info("DaisyTracker sent a compact dependency update summary.");
      return;
    }
    if (event.deleted) {
      await sendDiscordPayloads(config.discordWebhookUrl, [buildRefDeletedPayload(event, config)], {
        fetch: fetchImpl,
        threadId: config.threadId
      });
      info("DaisyTracker sent a deleted ref summary.");
      return;
    }
    const details = await fetchCommitDetails(event, {
      fetch: fetchImpl,
      maxCommits: config.maxCommits,
      token: config.githubToken
    });
    const payloads = buildPushPayloads(event, details, config);
    await sendDiscordPayloads(config.discordWebhookUrl, payloads, {
      fetch: fetchImpl,
      threadId: config.threadId
    });
    info(`DaisyTracker sent ${payloads.length} Discord webhook payload(s).`);
  } catch (error2) {
    if (shouldFailOnError(env)) {
      setFailed(error2);
    } else {
      warn(error2 instanceof Error ? error2.message : String(error2));
      process.exitCode = 0;
    }
  }
}
function setFailed(error2) {
  const message = error2 instanceof Error ? error2.message : String(error2);
  error(message);
  process.exitCode = 1;
}
function isPushEvent(event) {
  return event.eventName === "push" && "commits" in event;
}

// src/index.ts
void run();
