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
    sendOnEvents: parseCsv(getInput("send-on-events", env), ["push"]).map(
      (event) => event.toLowerCase()
    ),
    suppressMentions: parseBoolean(getInput("suppress-mentions", env), true),
    threadId: getInput("thread-id", env),
    threadName: getInput("thread-name", env),
    title: getInput("title", env),
    username: getInput("username", env)
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
function parseToken(value) {
  return value.includes("${{") ? "" : value;
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

// src/errors.ts
var DaisyTrackerError = class extends Error {
  kind;
  retryable;
  constructor(message, options) {
    super(message);
    this.name = "DaisyTrackerError";
    this.kind = options.kind;
    this.retryable = Boolean(options.retryable);
    if (options.cause !== void 0) {
      this.cause = options.cause;
    }
  }
};
function isDaisyTrackerError(error2) {
  return error2 instanceof DaisyTrackerError;
}
function shouldWarnOnly(error2) {
  return isDaisyTrackerError(error2) && (error2.kind === "delivery" || error2.kind === "github");
}
function redactSecrets(value, secrets = []) {
  let redacted = redactWebhookUrl(value);
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("***");
    }
  }
  redacted = redacted.replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1***");
  redacted = redacted.replace(/(bearer\s+)[a-z0-9_.-]+/gi, "$1***");
  return redacted;
}
function redactWebhookUrl(value) {
  return value.replace(/(\/api\/webhooks\/\d+\/)[^/?\s"']+/gi, "$1***");
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
    throw new DaisyTrackerError(
      `Discord webhook username exceeds ${DISCORD_LIMITS.username} characters.`,
      { kind: "internal" }
    );
  }
  if (!payload2.embeds.length) {
    throw new DaisyTrackerError("Discord webhook payload must contain at least one embed.", {
      kind: "internal"
    });
  }
  if (payload2.embeds.length > DISCORD_LIMITS.embeds) {
    throw new DaisyTrackerError(
      `Discord webhook payload exceeds ${DISCORD_LIMITS.embeds} embeds.`,
      {
        kind: "internal"
      }
    );
  }
  const total = payload2.embeds.reduce((sum, embed) => sum + validateEmbed(embed), 0);
  if (total > DISCORD_LIMITS.embedText) {
    throw new DaisyTrackerError(
      `Discord webhook embed text exceeds ${DISCORD_LIMITS.embedText} characters.`,
      { kind: "internal" }
    );
  }
}
function normalizeEmbedWithMetadata(embed) {
  let truncated = false;
  let droppedFields = Math.max(0, (embed.fields || []).length - DISCORD_LIMITS.fields);
  const fields = (embed.fields || []).slice(0, DISCORD_LIMITS.fields).map((field) => ({
    inline: Boolean(field.inline),
    name: truncateWithMetadata(field.name || "Field", DISCORD_LIMITS.fieldName),
    value: truncateWithMetadata(field.value || "_No content_", DISCORD_LIMITS.fieldValue)
  }));
  const normalized = {
    ...embed,
    author: embed.author?.name ? {
      ...embed.author,
      name: truncateWithMetadata(embed.author.name, DISCORD_LIMITS.authorName)
    } : embed.author,
    description: embed.description ? truncateWithMetadata(embed.description, DISCORD_LIMITS.description) : void 0,
    fields,
    footer: embed.footer?.text ? {
      ...embed.footer,
      text: truncateWithMetadata(embed.footer.text, DISCORD_LIMITS.footerText)
    } : embed.footer,
    title: embed.title ? truncateWithMetadata(embed.title, DISCORD_LIMITS.title) : void 0
  };
  while (embedTextLength(normalized) > DISCORD_LIMITS.embedText && normalized.fields?.length) {
    normalized.fields.pop();
    droppedFields += 1;
  }
  if (embedTextLength(normalized) > DISCORD_LIMITS.embedText && normalized.description) {
    normalized.description = truncateWithMetadata(
      normalized.description,
      Math.max(
        0,
        DISCORD_LIMITS.description - (embedTextLength(normalized) - DISCORD_LIMITS.embedText) - 16
      )
    );
  }
  return { droppedFields, embed: normalized, truncated };
  function truncateWithMetadata(value, limit) {
    if (value.length > limit) {
      truncated = true;
    }
    return truncate(value, limit);
  }
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
    throw new DaisyTrackerError(`Discord embed title exceeds ${DISCORD_LIMITS.title} characters.`, {
      kind: "internal"
    });
  }
  if (embed.description && embed.description.length > DISCORD_LIMITS.description) {
    throw new DaisyTrackerError(
      `Discord embed description exceeds ${DISCORD_LIMITS.description} characters.`,
      { kind: "internal" }
    );
  }
  if (embed.author?.name && embed.author.name.length > DISCORD_LIMITS.authorName) {
    throw new DaisyTrackerError(
      `Discord embed author exceeds ${DISCORD_LIMITS.authorName} characters.`,
      { kind: "internal" }
    );
  }
  if (embed.footer?.text && embed.footer.text.length > DISCORD_LIMITS.footerText) {
    throw new DaisyTrackerError(
      `Discord embed footer exceeds ${DISCORD_LIMITS.footerText} characters.`,
      { kind: "internal" }
    );
  }
  if ((embed.fields || []).length > DISCORD_LIMITS.fields) {
    throw new DaisyTrackerError(`Discord embed exceeds ${DISCORD_LIMITS.fields} fields.`, {
      kind: "internal"
    });
  }
  for (const field of embed.fields || []) {
    if (!field.name || !field.value) {
      throw new DaisyTrackerError("Discord embed fields must include non-empty name and value.", {
        kind: "internal"
      });
    }
    if (field.name.length > DISCORD_LIMITS.fieldName) {
      throw new DaisyTrackerError(
        `Discord embed field name exceeds ${DISCORD_LIMITS.fieldName} characters.`,
        { kind: "internal" }
      );
    }
    if (field.value.length > DISCORD_LIMITS.fieldValue) {
      throw new DaisyTrackerError(
        `Discord embed field value exceeds ${DISCORD_LIMITS.fieldValue} characters.`,
        { kind: "internal" }
      );
    }
  }
  return embedTextLength(embed);
}

// src/discord.ts
var DEFAULT_MAX_ATTEMPTS = 3;
var DEFAULT_TIMEOUT_MS = 1e4;
var MAX_RETRY_DELAY_MS = 1e4;
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
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = webhookExecuteUrl(webhookUrl, options.threadId);
  const redactionValues = [...options.redactValues || [], webhookToken(webhookUrl)];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          body: JSON.stringify(payload2),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "DaisyCatTs-DaisyTracker"
          },
          method: "POST"
        },
        timeoutMs
      );
    } catch (error2) {
      if (attempt < maxAttempts) {
        await sleep(fallbackRetryDelay(attempt));
        continue;
      }
      throw new DaisyTrackerError(
        `Discord webhook request failed for ${redactWebhookUrl(webhookUrl)}: ${redactSecrets(
          error2 instanceof Error ? error2.message : String(error2),
          redactionValues
        )}`,
        { cause: error2, kind: "delivery", retryable: true }
      );
    }
    if (response.ok) {
      return;
    }
    if (isConfigurationError(response.status)) {
      throw new DaisyTrackerError(
        await webhookErrorMessage(webhookUrl, response, redactionValues),
        {
          kind: "configuration"
        }
      );
    }
    if (attempt < maxAttempts && shouldRetry(response.status)) {
      await sleep(await retryDelay(response, attempt));
      continue;
    }
    throw new DaisyTrackerError(await webhookErrorMessage(webhookUrl, response, redactionValues), {
      kind: "delivery",
      retryable: shouldRetry(response.status)
    });
  }
}
function validateWebhookUrl(webhookUrl) {
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new DaisyTrackerError("Discord webhook URL is not a valid URL.", {
      kind: "configuration"
    });
  }
  if (parsed.protocol !== "https:") {
    throw new DaisyTrackerError("Discord webhook URL must use https.", {
      kind: "configuration"
    });
  }
}
function shouldRetry(status) {
  return status === 429 || status >= 500;
}
function isConfigurationError(status) {
  return status === 401 || status === 403 || status === 404;
}
async function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const parsed = parseRetryAfter(retryAfter);
    if (parsed !== void 0) {
      return parsed;
    }
  }
  const resetAfter = response.headers.get("x-ratelimit-reset-after");
  if (resetAfter) {
    const parsed = Number.parseFloat(resetAfter);
    if (Number.isFinite(parsed)) {
      return Math.min(parsed * 1e3, MAX_RETRY_DELAY_MS);
    }
  }
  if (response.status === 429) {
    try {
      const body = await response.clone().json();
      if (typeof body.retry_after === "number") {
        return Math.min(body.retry_after * 1e3, MAX_RETRY_DELAY_MS);
      }
    } catch {
      return fallbackRetryDelay(attempt);
    }
  }
  return fallbackRetryDelay(attempt);
}
async function webhookErrorMessage(webhookUrl, response, redactionValues) {
  return `Discord webhook request failed with ${response.status} for ${redactWebhookUrl(
    webhookUrl
  )}: ${redactSecrets(await responseSnippet(response), redactionValues)}`;
}
async function responseSnippet(response) {
  try {
    return (await response.text()).slice(0, 500) || response.statusText;
  } catch {
    return response.statusText;
  }
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
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error2) {
    if (error2 instanceof Error && error2.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw error2;
  } finally {
    clearTimeout(timeout);
  }
}
function parseRetryAfter(value) {
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) {
    return Math.min(seconds * 1e3, MAX_RETRY_DELAY_MS);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS);
  }
  return void 0;
}
function fallbackRetryDelay(attempt) {
  return Math.min(1e3 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_DELAY_MS);
}
function webhookToken(webhookUrl) {
  try {
    const segments = new URL(webhookUrl).pathname.split("/");
    return segments.at(-1) || "";
  } catch {
    return "";
  }
}

// src/language-data.ts
var LANGUAGE_BY_EXTENSION = {
  _coffee: { color: 2377590, name: "CoffeeScript" },
  _js: { color: 15851610, icon: "javascript", name: "JavaScript" },
  _ls: { color: 4823174, name: "LiveScript" },
  "1": { color: 15523518, name: "Roff" },
  "1in": { color: 15523518, name: "Roff" },
  "1m": { color: 15523518, name: "Roff" },
  "1x": { color: 15523518, name: "Roff" },
  "2": { color: 15523518, name: "Roff" },
  "2da": { color: 3700253, name: "2-Dimensional Array" },
  "3": { color: 15523518, name: "Roff" },
  "3in": { color: 15523518, name: "Roff" },
  "3m": { color: 15523518, name: "Roff" },
  "3p": { color: 15523518, name: "Roff" },
  "3pm": { color: 15523518, name: "Roff" },
  "3qt": { color: 15523518, name: "Roff" },
  "3x": { color: 15523518, name: "Roff" },
  "4": { color: 15523518, name: "Roff" },
  "4dform": { color: 2697513, name: "JSON" },
  "4dm": { color: 17033, name: "4D" },
  "4dproject": { color: 2697513, name: "JSON" },
  "4gl": { color: 6504590, name: "Genero 4gl" },
  "4th": { color: 3413768, name: "Forth" },
  "5": { color: 15523518, name: "Roff" },
  "6": { color: 15523518, name: "Roff" },
  "6pl": { color: 251, name: "Raku" },
  "6pm": { color: 251, name: "Raku" },
  "7": { color: 15523518, name: "Roff" },
  "8": { color: 15523518, name: "Roff" },
  "8xp": { color: 10529415, name: "TI Program" },
  "8xp.txt": { color: 10529415, name: "TI Program" },
  "9": { color: 15523518, name: "Roff" },
  a51: { color: 7228435, name: "Assembly" },
  abap: { color: 15214411, name: "ABAP" },
  abnf: { color: 5793266, name: "ABNF" },
  action: { color: 2240846, name: "ROS Interface" },
  ada: { color: 194700, name: "Ada" },
  adb: { color: 194700, name: "Ada" },
  adml: { color: 24748, name: "XML" },
  admx: { color: 24748, name: "XML" },
  ado: { color: 1728401, name: "Stata" },
  adoc: { color: 7577797, name: "AsciiDoc" },
  adp: { color: 14994584, name: "Tcl" },
  ads: { color: 194700, name: "Ada" },
  afm: { color: 16387840, name: "Adobe Font Metrics" },
  agc: { color: 7228435, name: "Assembly" },
  agda: { color: 3233381, name: "Agda" },
  ahk: { color: 6657209, name: "AutoHotkey" },
  ahkl: { color: 6657209, name: "AutoHotkey" },
  aidl: { color: 3468139, name: "AIDL" },
  aj: { color: 11098032, name: "AspectJ" },
  ak: { color: 6557688, name: "Aiken" },
  al: { color: 170179, name: "Perl" },
  alg: { color: 13754587, name: "ALGOL" },
  als: { color: 6604800, name: "Alloy" },
  ampl: { color: 15134651, name: "AMPL" },
  angelscript: { color: 13096924, name: "AngelScript" },
  anim: { color: 2239543, name: "Unity3D Asset" },
  ant: { color: 24748, name: "XML" },
  "antlers.html": { color: 16721566, name: "Antlers" },
  "antlers.php": { color: 16721566, name: "Antlers" },
  "antlers.xml": { color: 16721566, name: "Antlers" },
  apacheconf: { color: 13705511, name: "ApacheConf" },
  apex: { color: 1546176, name: "Apex" },
  apib: { color: 2804904, name: "API Blueprint" },
  apl: { color: 5931364, name: "APL" },
  app: { color: 12073368, name: "Erlang" },
  "app.src": { color: 12073368, name: "Erlang" },
  applescript: { color: 1056543, name: "AppleScript" },
  arc: { color: 11152126, name: "Arc" },
  arpa: { color: 5793266, name: "DNS Zone" },
  arr: { color: 15605264, name: "Pyret" },
  as: { color: 13096924, name: "AngelScript" },
  asax: { color: 9699583, name: "ASP.NET" },
  asc: { color: 5793266, name: "Public Key" },
  asciidoc: { color: 7577797, name: "AsciiDoc" },
  ascx: { color: 9699583, name: "ASP.NET" },
  asd: { color: 4175499, name: "Common Lisp" },
  asddls: { color: 5594661, name: "ABAP CDS" },
  ash: { color: 12179897, name: "KoLmafia ASH" },
  ashx: { color: 9699583, name: "ASP.NET" },
  asl: { color: 5793266, name: "ASL" },
  asm: { color: 7228435, name: "Assembly" },
  asmx: { color: 9699583, name: "ASP.NET" },
  asn: { color: 5793266, name: "ASN.1" },
  asn1: { color: 5793266, name: "ASN.1" },
  asp: { color: 6963453, name: "Classic ASP" },
  aspx: { color: 9699583, name: "ASP.NET" },
  asset: { color: 2239543, name: "Unity3D Asset" },
  astro: { color: 16734723, name: "Astro" },
  asy: { color: 5793266, name: "LTspice Symbol" },
  au3: { color: 1848658, name: "AutoIt" },
  aug: { color: 10273076, name: "Augeas" },
  auk: { color: 12783259, name: "Awk" },
  aux: { color: 4022551, name: "TeX" },
  avdl: { color: 16639, name: "Avro IDL" },
  avsc: { color: 2697513, name: "JSON" },
  aw: { color: 5201301, icon: "php", name: "PHP" },
  awk: { color: 12783259, name: "Awk" },
  axaml: { color: 24748, name: "XML" },
  axd: { color: 9699583, name: "ASP.NET" },
  axi: { color: 696575, name: "NetLinx" },
  "axi.erb": { color: 7634858, name: "NetLinx+ERB" },
  axml: { color: 24748, name: "XML" },
  axs: { color: 696575, name: "NetLinx" },
  "axs.erb": { color: 7634858, name: "NetLinx+ERB" },
  b: { color: 5793266, name: "Limbo" },
  bal: { color: 16732160, name: "Ballerina" },
  baml: { color: 11032055, name: "BAML" },
  bas: { color: 2909011, name: "Visual Basic 6.0" },
  bash: { color: 9035857, name: "Shell" },
  bat: { color: 12710190, name: "Batchfile" },
  bats: { color: 9035857, name: "Shell" },
  bb: { color: 14374997, name: "Clojure" },
  bbappend: { color: 48356, name: "BitBake" },
  bbclass: { color: 48356, name: "BitBake" },
  bbx: { color: 4022551, name: "TeX" },
  bdf: { color: 5793266, name: "Glyph Bitmap Distribution Format" },
  bdy: { color: 14342360, name: "PLSQL" },
  be: { color: 1417532, name: "Berry" },
  befunge: { color: 5793266, name: "Befunge" },
  bf: { color: 5793266, name: "HyPhy" },
  bi: { color: 32896, name: "QuickBASIC" },
  bib: { color: 4022551, name: "TeX" },
  bibtex: { color: 4022551, name: "TeX" },
  bicep: { color: 5348026, name: "Bicep" },
  bicepparam: { color: 5348026, name: "Bicep" },
  bison: { color: 4942923, name: "Yacc" },
  blade: { color: 16208447, name: "Blade" },
  "blade.php": { color: 16208447, name: "Blade" },
  bmx: { color: 13460480, name: "BlitzMax" },
  bones: { color: 15851610, icon: "javascript", name: "JavaScript" },
  boo: { color: 13942465, name: "Boo" },
  boot: { color: 14374997, name: "Clojure" },
  bpl: { color: 13111200, name: "Boogie" },
  bqn: { color: 2846823, name: "BQN" },
  brd: { color: 3099307, name: "KiCad Legacy Layout" },
  bro: { color: 5793266, name: "Zeek" },
  brs: { color: 6696337, name: "Brightscript" },
  bru: { color: 16034369, name: "Bru" },
  bs: { color: 6728379, name: "BrighterScript" },
  bsl: { color: 8473804, name: "1C Enterprise" },
  bst: { color: 27647, name: "BuildStream" },
  bsv: { color: 1188412, name: "Bluespec" },
  builder: { color: 7345430, icon: "ruby", name: "Ruby" },
  builds: { color: 24748, name: "XML" },
  bzl: { color: 7787125, name: "Starlark" },
  c: { color: 5592405, name: "C" },
  "c-objdump": { color: 5793266, name: "C-ObjDump" },
  "c++": { color: 15944573, icon: "cpp", name: "C++" },
  "c++-objdump": { color: 5793266, name: "Cpp-ObjDump" },
  "c++objdump": { color: 5793266, name: "Cpp-ObjDump" },
  c3: { color: 2450411, name: "C3" },
  cabal: { color: 4732005, name: "Cabal Config" },
  caddyfile: { color: 2274872, name: "Caddyfile" },
  cairo: { color: 16730696, name: "Cairo" },
  cake: { color: 2377590, name: "CoffeeScript" },
  capnp: { color: 12855079, name: "Cap'n Proto" },
  carbon: { color: 2236962, name: "Carbon" },
  cats: { color: 5592405, name: "C" },
  cbl: { color: 5793266, name: "COBOL" },
  cbx: { color: 4022551, name: "TeX" },
  cc: { color: 15944573, icon: "cpp", name: "C++" },
  ccp: { color: 5793266, name: "COBOL" },
  ccproj: { color: 24748, name: "XML" },
  ccxml: { color: 24748, name: "XML" },
  cdc: { color: 61323, name: "Cadence" },
  cdf: { color: 14487808, name: "Wolfram Language" },
  cds: { color: 37585, name: "CAP CDS" },
  ceylon: { color: 14656821, name: "Ceylon" },
  cfc: { color: 15543510, name: "ColdFusion" },
  cfg: { color: 13753312, name: "INI" },
  cfm: { color: 15543510, name: "ColdFusion" },
  cfml: { color: 15543510, name: "ColdFusion" },
  cgi: { color: 9035857, name: "Shell" },
  cginc: { color: 11193952, name: "HLSL" },
  ch: { color: 4209216, name: "xBase" },
  chem: { color: 15523518, name: "Roff" },
  chpl: { color: 9291327, name: "Chapel" },
  chs: { color: 6180998, name: "Haskell" },
  cil: { color: 5793266, name: "CIL" },
  circom: { color: 7370101, name: "Circom" },
  cirru: { color: 13421823, name: "Cirru" },
  cj: { color: 34443, name: "Cangjie" },
  cjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  cjsx: { color: 2377590, name: "CoffeeScript" },
  ck: { color: 4161536, name: "ChucK" },
  cl: { color: 5592405, name: "C" },
  cl2: { color: 14374997, name: "Clojure" },
  clar: { color: 5588735, name: "Clarity" },
  click: { color: 15001331, name: "Click" },
  clixml: { color: 24748, name: "XML" },
  clj: { color: 14374997, name: "Clojure" },
  cljc: { color: 14374997, name: "Clojure" },
  cljs: { color: 14374997, name: "Clojure" },
  "cljs.hl": { color: 14374997, name: "Clojure" },
  cljscm: { color: 14374997, name: "Clojure" },
  cljx: { color: 14374997, name: "Clojure" },
  clp: { color: 41728, name: "CLIPS" },
  cls: { color: 2909011, name: "Visual Basic 6.0" },
  clue: { color: 2485, name: "Clue" },
  clw: { color: 14389278, name: "Clarion" },
  cmake: { color: 14300212, name: "CMake" },
  "cmake.in": { color: 14300212, name: "CMake" },
  cmd: { color: 12710190, name: "Batchfile" },
  cmp: { color: 13765376, name: "Gerber Image" },
  cnc: { color: 13667570, name: "G-code" },
  cnf: { color: 13753312, name: "INI" },
  cob: { color: 5793266, name: "COBOL" },
  cobol: { color: 5793266, name: "COBOL" },
  cocci: { color: 13191497, name: "SmPL" },
  "code-snippets": { color: 2697513, name: "JSON" },
  "code-workspace": { color: 2697513, name: "JSON" },
  coffee: { color: 2377590, name: "CoffeeScript" },
  "coffee.md": { color: 2377590, name: "CoffeeScript" },
  com: { color: 5793266, name: "DIGITAL Command Language" },
  command: { color: 9035857, name: "Shell" },
  conll: { color: 5793266, name: "CoNLL-U" },
  conllu: { color: 5793266, name: "CoNLL-U" },
  container: { color: 13753312, name: "INI" },
  containerfile: { color: 3689812, name: "Dockerfile" },
  cook: { color: 14768681, name: "Cooklang" },
  coq: { color: 13678220, name: "Rocq Prover" },
  cp: { color: 11587150, name: "Component Pascal" },
  cpp: { color: 15944573, icon: "cpp", name: "C++" },
  "cpp-objdump": { color: 5793266, name: "Cpp-ObjDump" },
  cppm: { color: 15944573, icon: "cpp", name: "C++" },
  cppobjdump: { color: 5793266, name: "Cpp-ObjDump" },
  cproject: { color: 24748, name: "XML" },
  cps: { color: 11587150, name: "Component Pascal" },
  cpy: { color: 5793266, name: "COBOL" },
  cql: { color: 24721, name: "CQL" },
  cr: { color: 256, name: "Crystal" },
  crc32: { color: 5793266, name: "Checksums" },
  creole: { color: 5793266, name: "Creole" },
  cs: { color: 1541632, icon: "csharp", name: "C#" },
  "cs.pp": { color: 1541632, icon: "csharp", name: "C#" },
  csc: { color: 16738304, name: "GSC" },
  cscfg: { color: 24748, name: "XML" },
  csd: { color: 1710618, name: "Csound Document" },
  csdef: { color: 24748, name: "XML" },
  csh: { color: 9035857, name: "Shell" },
  cshtml: { color: 14896166, icon: "html", name: "HTML" },
  csl: { color: 24748, name: "XML" },
  cson: { color: 2377590, name: "CSON" },
  csproj: { color: 24748, name: "XML" },
  css: { color: 6697881, icon: "css", name: "CSS" },
  csv: { color: 2323270, name: "CSV" },
  csx: { color: 1541632, icon: "csharp", name: "C#" },
  ct: { color: 24748, name: "XML" },
  ctl: { color: 2909011, name: "Visual Basic 6.0" },
  ctp: { color: 5201301, icon: "php", name: "PHP" },
  cts: { color: 3242182, icon: "typescript", name: "TypeScript" },
  cu: { color: 3821114, name: "Cuda" },
  cue: { color: 5793266, name: "Cue Sheet" },
  cuh: { color: 3821114, name: "Cuda" },
  curry: { color: 5444162, name: "Curry" },
  cw: { color: 5793266, name: "Redcode" },
  cwl: { color: 11874636, name: "Common Workflow Language" },
  cxx: { color: 15944573, icon: "cpp", name: "C++" },
  "cxx-objdump": { color: 5793266, name: "Cpp-ObjDump" },
  cy: { color: 5793266, name: "Cycript" },
  cylc: { color: 13753312, name: "INI" },
  cyp: { color: 3457259, name: "Cypher" },
  cypher: { color: 3457259, name: "Cypher" },
  d: { color: 4356121, name: "Makefile" },
  "d-objdump": { color: 5793266, name: "D-ObjDump" },
  d2: { color: 5402344, name: "D2" },
  dae: { color: 15836203, name: "COLLADA" },
  darcspatch: { color: 9371427, name: "Darcs Patch" },
  dart: { color: 46251, name: "Dart" },
  das: { color: 13882323, name: "Daslang" },
  dats: { color: 1754656, name: "ATS" },
  db2: { color: 14912512, name: "SQLPL" },
  dcl: { color: 4162991, name: "Clean" },
  ddl: { color: 14912512, name: "SQL" },
  decls: { color: 65454, name: "BlitzBasic" },
  depproj: { color: 24748, name: "XML" },
  desktop: { color: 13753312, name: "INI" },
  "desktop.in": { color: 13753312, name: "INI" },
  dfm: { color: 14938481, name: "Pascal" },
  dfy: { color: 16772133, name: "Dafny" },
  dhall: { color: 14659583, name: "Dhall" },
  di: { color: 12212574, name: "D" },
  diff: { color: 5793266, name: "Diff" },
  dircolors: { color: 5793266, name: "dircolors" },
  dita: { color: 24748, name: "XML" },
  ditamap: { color: 24748, name: "XML" },
  ditaval: { color: 24748, name: "XML" },
  djs: { color: 13412192, name: "Dogescript" },
  "dll.config": { color: 24748, name: "XML" },
  dlm: { color: 10703407, name: "IDL" },
  dm: { color: 4485733, name: "DM" },
  do: { color: 1728401, name: "Stata" },
  dockerfile: { color: 3689812, name: "Dockerfile" },
  dof: { color: 13753312, name: "INI" },
  doh: { color: 1728401, name: "Stata" },
  dot: { color: 2463422, name: "Graphviz (DOT)" },
  dotsettings: { color: 24748, name: "XML" },
  dpatch: { color: 9371427, name: "Darcs Patch" },
  dpr: { color: 14938481, name: "Pascal" },
  druby: { color: 13084984, name: "Mirah" },
  dsc: { color: 16510614, name: "DenizenScript" },
  dsl: { color: 5793266, name: "ASL" },
  dsp: { color: 5793266, name: "Microsoft Developer Studio Project" },
  dsr: { color: 2909011, name: "Visual Basic 6.0" },
  dtx: { color: 4022551, name: "TeX" },
  duby: { color: 13084984, name: "Mirah" },
  dwl: { color: 14930, name: "DataWeave" },
  dyalog: { color: 5931364, name: "APL" },
  dyl: { color: 7102830, name: "Dylan" },
  dylan: { color: 7102830, name: "Dylan" },
  dzn: { color: 5793266, name: "MiniZinc Data" },
  e: { color: 16742667, name: "Euphoria" },
  "eam.fs": { color: 5793266, name: "Formatted" },
  eb: { color: 3502757, icon: "python", name: "Python" },
  ebnf: { color: 5793266, name: "EBNF" },
  ebuild: { color: 9035857, name: "Shell" },
  ec: { color: 9517408, name: "eC" },
  ecl: { color: 7612476, name: "Prolog" },
  eclass: { color: 9035857, name: "Shell" },
  eclxml: { color: 9048679, name: "ECL" },
  ecr: { color: 14896166, icon: "html", name: "HTML" },
  ect: { color: 11083344, name: "EJS" },
  edc: { color: 5793266, name: "Edje Data Collection" },
  edge: { color: 917472, name: "Edge" },
  edgeql: { color: 3254271, name: "EdgeQL" },
  editorconfig: { color: 13753312, name: "INI" },
  edn: { color: 5793266, name: "edn" },
  eh: { color: 9517408, name: "eC" },
  ejs: { color: 11083344, name: "EJS" },
  "ejs.t": { color: 11083344, name: "EJS" },
  el: { color: 12608987, name: "Emacs Lisp" },
  eliom: { color: 15694344, name: "OCaml" },
  eliomi: { color: 15694344, name: "OCaml" },
  elm: { color: 6337996, name: "Elm" },
  elv: { color: 5618517, name: "Elvish" },
  em: { color: 16774387, name: "EmberScript" },
  emacs: { color: 12608987, name: "Emacs Lisp" },
  "emacs.desktop": { color: 12608987, name: "Emacs Lisp" },
  emberscript: { color: 16774387, name: "EmberScript" },
  eml: { color: 5793266, name: "E-mail" },
  env: { color: 15062361, name: "Dotenv" },
  epj: { color: 15851610, icon: "javascript", name: "JavaScript" },
  eps: { color: 14297372, name: "PostScript" },
  epsi: { color: 14297372, name: "PostScript" },
  eq: { color: 10978889, name: "EQ" },
  erb: { color: 14896166, icon: "html", name: "HTML" },
  "erb.deface": { color: 14896166, icon: "html", name: "HTML" },
  erl: { color: 12073368, name: "Erlang" },
  es: { color: 15851610, icon: "javascript", name: "JavaScript" },
  es6: { color: 15851610, icon: "javascript", name: "JavaScript" },
  escript: { color: 12073368, name: "Erlang" },
  esdl: { color: 3254271, name: "EdgeQL" },
  ex: { color: 16742667, name: "Euphoria" },
  exs: { color: 7228030, name: "Elixir" },
  eye: { color: 7345430, icon: "ruby", name: "Ruby" },
  f: { color: 5063089, name: "Fortran" },
  f03: { color: 5063089, name: "Fortran" },
  f08: { color: 5063089, name: "Fortran" },
  f77: { color: 5063089, name: "Fortran" },
  f90: { color: 5063089, name: "Fortran" },
  f95: { color: 5063089, name: "Fortran" },
  factor: { color: 6514502, name: "Factor" },
  fan: { color: 1320252, name: "Fantom" },
  fancypack: { color: 8101300, name: "Fancy" },
  fbs: { color: 15542346, name: "FlatBuffers" },
  fcgi: { color: 9035857, name: "Shell" },
  fea: { color: 5793266, name: "OpenType Feature File" },
  feature: { color: 5972067, name: "Gherkin" },
  filters: { color: 24748, name: "XML" },
  fir: { color: 3105583, name: "FIRRTL" },
  fish: { color: 9035857, name: "Shell" },
  flex: { color: 14404096, name: "Lex" },
  flf: { color: 16768443, name: "FIGlet Font" },
  flix: { color: 13912645, name: "Flix" },
  flux: { color: 8965375, name: "FLUX" },
  fnc: { color: 14342360, name: "PLSQL" },
  fnl: { color: 16774103, name: "Fennel" },
  for: { color: 5063089, name: "Fortran" },
  forth: { color: 3413768, name: "Forth" },
  fp: { color: 5670565, name: "GLSL" },
  fpp: { color: 5063089, name: "Fortran" },
  fr: { color: 5793266, name: "Text" },
  frag: { color: 15851610, icon: "javascript", name: "JavaScript" },
  frg: { color: 5670565, name: "GLSL" },
  frm: { color: 2909011, name: "Visual Basic 6.0" },
  frt: { color: 3413768, name: "Forth" },
  fs: { color: 12076540, name: "F#" },
  fsh: { color: 5670565, name: "GLSL" },
  fshader: { color: 5670565, name: "GLSL" },
  fsi: { color: 12076540, name: "F#" },
  fsproj: { color: 24748, name: "XML" },
  fst: { color: 5713456, name: "F*" },
  fsti: { color: 5713456, name: "F*" },
  fsx: { color: 12076540, name: "F#" },
  fth: { color: 3413768, name: "Forth" },
  ftl: { color: 20658, name: "FreeMarker" },
  ftlh: { color: 20658, name: "FreeMarker" },
  fun: { color: 14440045, name: "Standard ML" },
  fut: { color: 6226463, name: "Futhark" },
  fx: { color: 11193952, name: "HLSL" },
  fxh: { color: 11193952, name: "HLSL" },
  fxml: { color: 24748, name: "XML" },
  fy: { color: 8101300, name: "Fancy" },
  g: { color: 204, name: "GAP" },
  g4: { color: 10339327, name: "ANTLR" },
  gaml: { color: 16762726, name: "GAML" },
  gap: { color: 204, name: "GAP" },
  gawk: { color: 12783259, name: "Awk" },
  gbl: { color: 13765376, name: "Gerber Image" },
  gbo: { color: 13765376, name: "Gerber Image" },
  gbp: { color: 13765376, name: "Gerber Image" },
  gbr: { color: 13765376, name: "Gerber Image" },
  gbs: { color: 13765376, name: "Gerber Image" },
  gco: { color: 13667570, name: "G-code" },
  gcode: { color: 13667570, name: "G-code" },
  gd: { color: 3495280, name: "GDScript" },
  gdb: { color: 5793266, name: "GDB" },
  gdbinit: { color: 5793266, name: "GDB" },
  gdnlib: { color: 3495280, name: "Godot Resource" },
  gdns: { color: 3495280, name: "Godot Resource" },
  gdshader: { color: 4689087, name: "GDShader" },
  gdshaderinc: { color: 4689087, name: "GDShader" },
  ged: { color: 12376, name: "GEDCOM" },
  gemspec: { color: 7345430, icon: "ruby", name: "Ruby" },
  geo: { color: 5670565, name: "GLSL" },
  geojson: { color: 2697513, name: "JSON" },
  geom: { color: 5670565, name: "GLSL" },
  gf: { color: 16711680, name: "Grammatical Framework" },
  gi: { color: 204, name: "GAP" },
  gitconfig: { color: 13753312, name: "INI" },
  gitignore: { color: 5793266, name: "Ignore List" },
  gjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  gko: { color: 13765376, name: "Gerber Image" },
  glade: { color: 24748, name: "XML" },
  gleam: { color: 16756723, name: "Gleam" },
  glf: { color: 12692607, name: "Glyph" },
  glsl: { color: 5670565, name: "GLSL" },
  glslf: { color: 5670565, name: "GLSL" },
  glslv: { color: 5670565, name: "GLSL" },
  gltf: { color: 2697513, name: "JSON" },
  glyphs: { color: 5793266, name: "OpenStep Property List" },
  gmi: { color: 16738560, name: "Gemini" },
  gml: { color: 24748, name: "XML" },
  gms: { color: 16030242, name: "GAMS" },
  gmx: { color: 24748, name: "XML" },
  gn: { color: 5793266, name: "GN" },
  gni: { color: 5793266, name: "GN" },
  gnu: { color: 15772144, name: "Gnuplot" },
  gnuplot: { color: 15772144, name: "Gnuplot" },
  go: { color: 44504, icon: "go", name: "Go" },
  god: { color: 7345430, icon: "ruby", name: "Ruby" },
  gohtml: { color: 44504, name: "Go Template" },
  golo: { color: 8934954, name: "Golo" },
  gotmpl: { color: 44504, name: "Go Template" },
  gp: { color: 15772144, name: "Gnuplot" },
  gpb: { color: 13765376, name: "Gerber Image" },
  gpt: { color: 13765376, name: "Gerber Image" },
  gpx: { color: 24748, name: "XML" },
  gql: { color: 14745752, name: "GraphQL" },
  grace: { color: 6381451, name: "Grace" },
  gradle: { color: 143418, name: "Gradle" },
  "gradle.kts": { color: 143418, name: "Gradle" },
  graphql: { color: 14745752, name: "GraphQL" },
  graphqls: { color: 14745752, name: "GraphQL" },
  groovy: { color: 4364472, name: "Groovy" },
  grt: { color: 4364472, name: "Groovy" },
  grxml: { color: 24748, name: "XML" },
  gs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  gsc: { color: 16738304, name: "GSC" },
  gsh: { color: 16738304, name: "GSC" },
  gshader: { color: 5670565, name: "GLSL" },
  gsp: { color: 4364472, name: "Groovy" },
  gst: { color: 24748, name: "XML" },
  gsx: { color: 8557439, name: "Gosu" },
  gtkrc: { color: 8382233, name: "GtkRC" },
  gtl: { color: 13765376, name: "Gerber Image" },
  gto: { color: 13765376, name: "Gerber Image" },
  gtp: { color: 13765376, name: "Gerber Image" },
  gtpl: { color: 4364472, name: "Groovy" },
  gts: { color: 3242182, icon: "typescript", name: "TypeScript" },
  gv: { color: 2463422, name: "Graphviz (DOT)" },
  gvy: { color: 4364472, name: "Groovy" },
  gyp: { color: 3502757, icon: "python", name: "Python" },
  gypi: { color: 3502757, icon: "python", name: "Python" },
  h: { color: 11057612, name: "C/C++ Header" },
  "h.in": { color: 5592405, name: "C" },
  "h++": { color: 15944573, icon: "cpp", name: "C++" },
  ha: { color: 10318884, name: "Hare" },
  hack: { color: 8882055, name: "Hack" },
  haml: { color: 15524521, name: "Haml" },
  "haml.deface": { color: 15524521, name: "Haml" },
  handlebars: { color: 16225054, name: "Handlebars" },
  har: { color: 2697513, name: "JSON" },
  hats: { color: 1754656, name: "ATS" },
  hb: { color: 942307, name: "Harbour" },
  hbs: { color: 16225054, name: "Handlebars" },
  hc: { color: 16773039, name: "HolyC" },
  hcl: { color: 8671162, name: "HCL" },
  heex: { color: 14896166, icon: "html", name: "HTML" },
  hh: { color: 8882055, name: "Hack" },
  hhi: { color: 8882055, name: "Hack" },
  hic: { color: 14374997, name: "Clojure" },
  hip: { color: 5192271, name: "HIP" },
  hlean: { color: 5793266, name: "Lean" },
  hlsl: { color: 11193952, name: "HLSL" },
  hlsli: { color: 11193952, name: "HLSL" },
  hocon: { color: 10483950, name: "HOCON" },
  hoon: { color: 45425, name: "hoon" },
  hpp: { color: 15944573, icon: "cpp", name: "C++" },
  hqf: { color: 4144959, name: "SQF" },
  hql: { color: 14475776, name: "HiveQL" },
  hrl: { color: 12073368, name: "Erlang" },
  hs: { color: 6180998, name: "Haskell" },
  "hs-boot": { color: 6180998, name: "Haskell" },
  hsc: { color: 6180998, name: "Haskell" },
  hta: { color: 14896166, icon: "html", name: "HTML" },
  htm: { color: 14896166, icon: "html", name: "HTML" },
  html: { color: 14896166, icon: "html", name: "HTML" },
  "html.eex": { color: 14896166, icon: "html", name: "HTML" },
  "html.hl": { color: 14896166, icon: "html", name: "HTML" },
  "html.tmpl": { color: 44504, name: "Go Template" },
  http: { color: 23708, name: "HTTP" },
  hurl: { color: 16712328, name: "Hurl" },
  hx: { color: 14645504, name: "Haxe" },
  hxml: { color: 16156434, name: "HXML" },
  hxsl: { color: 14645504, name: "Haxe" },
  hxx: { color: 15944573, icon: "cpp", name: "C++" },
  hy: { color: 7835826, name: "Hy" },
  hzp: { color: 24748, name: "XML" },
  i: { color: 5793266, name: "SWIG" },
  i3: { color: 2241416, name: "Modula-3" },
  i7x: { color: 5793266, name: "Inform 7" },
  ical: { color: 15488588, name: "iCalendar" },
  ice: { color: 16290, name: "Slice" },
  iced: { color: 2377590, name: "CoffeeScript" },
  icl: { color: 4162991, name: "Clean" },
  icls: { color: 24748, name: "XML" },
  ics: { color: 15488588, name: "iCalendar" },
  idc: { color: 5592405, name: "C" },
  idr: { color: 11730944, name: "Idris" },
  ig: { color: 2241416, name: "Modula-3" },
  ihlp: { color: 1728401, name: "Stata" },
  ijm: { color: 10070783, name: "ImageJ Macro" },
  ijs: { color: 10415615, name: "J" },
  ik: { color: 491923, name: "Ioke" },
  il: { color: 5319636, name: "IL Assembly" },
  ily: { color: 10275964, name: "LilyPond" },
  imba: { color: 1494726, name: "Imba" },
  iml: { color: 24748, name: "XML" },
  inc: { color: 16162333, name: "SourcePawn" },
  ini: { color: 13753312, name: "INI" },
  ink: { color: 5793266, name: "Ink" },
  inl: { color: 15944573, icon: "cpp", name: "C++" },
  ino: { color: 15944573, icon: "cpp", name: "C++" },
  ins: { color: 4022551, name: "TeX" },
  intr: { color: 7102830, name: "Dylan" },
  io: { color: 11081869, name: "Io" },
  iol: { color: 8663417, name: "Jolie" },
  ipf: { color: 204, name: "IGOR Pro" },
  ipp: { color: 15944573, icon: "cpp", name: "C++" },
  ipynb: { color: 14310155, name: "Jupyter Notebook" },
  irclog: { color: 5793266, name: "IRC log" },
  isl: { color: 2509721, name: "Inno Setup" },
  ispc: { color: 2975921, name: "ISPC" },
  iss: { color: 2509721, name: "Inno Setup" },
  iuml: { color: 16497942, name: "PlantUML" },
  ivy: { color: 24748, name: "XML" },
  ixx: { color: 15944573, icon: "cpp", name: "C++" },
  j: { color: 16714842, name: "Objective-J" },
  j2: { color: 10824226, name: "Jinja" },
  jac: { color: 16546093, name: "Jac" },
  jade: { color: 11035732, name: "Pug" },
  jai: { color: 11242315, name: "Jai" },
  jake: { color: 15851610, icon: "javascript", name: "JavaScript" },
  janet: { color: 558757, name: "Janet" },
  jav: { color: 11563545, icon: "java", name: "Java" },
  java: { color: 11563545, icon: "java", name: "Java" },
  javascript: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jbuilder: { color: 7345430, icon: "ruby", name: "Ruby" },
  jcl: { color: 14224905, name: "JCL" },
  jelly: { color: 24748, name: "XML" },
  jflex: { color: 14404096, name: "Lex" },
  jinja: { color: 10824226, name: "Jinja" },
  jinja2: { color: 10824226, name: "Jinja" },
  jison: { color: 4942923, name: "Yacc" },
  jisonlex: { color: 14404096, name: "Lex" },
  jl: { color: 10645690, name: "Julia" },
  jq: { color: 13051214, name: "jq" },
  js: { color: 15851610, icon: "javascript", name: "JavaScript" },
  "js.erb": { color: 15851610, icon: "javascript", name: "JavaScript" },
  jsb: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jscad: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jsfl: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jsh: { color: 11563545, icon: "java", name: "Java" },
  jslib: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jsm: { color: 15851610, icon: "javascript", name: "JavaScript" },
  json: { color: 2697513, name: "JSON" },
  "json-tmlanguage": { color: 2697513, name: "JSON" },
  "json.example": { color: 2697513, name: "JSON" },
  json5: { color: 2522297, name: "JSON5" },
  jsonc: { color: 2697513, name: "JSON" },
  jsonl: { color: 2697513, name: "JSON" },
  jsonld: { color: 804764, name: "JSONLD" },
  jsonnet: { color: 25789, name: "Jsonnet" },
  jsp: { color: 11563545, icon: "java", name: "Java" },
  jspre: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jsproj: { color: 24748, name: "XML" },
  jss: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jst: { color: 11083344, name: "EJS" },
  jsx: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jte: { color: 11563545, icon: "java", name: "Java" },
  just: { color: 3689812, name: "Just" },
  k: { color: 4298181, name: "KFramework" },
  kak: { color: 7307330, name: "KakouneScript" },
  kdl: { color: 16757683, name: "KDL" },
  kicad_mod: { color: 3099307, name: "KiCad Layout" },
  kicad_pcb: { color: 3099307, name: "KiCad Layout" },
  kicad_sch: { color: 3099307, name: "KiCad Schematic" },
  kicad_sym: { color: 3099307, name: "KiCad Schematic" },
  kicad_wks: { color: 3099307, name: "KiCad Layout" },
  kid: { color: 9770289, name: "Genshi" },
  kit: { color: 5793266, name: "Kit" },
  kk: { color: 2183526, name: "Koka" },
  kml: { color: 24748, name: "XML" },
  kojo: { color: 12725568, name: "Scala" },
  kql: { color: 5793266, name: "Kusto" },
  krl: { color: 2638602, name: "KRL" },
  ks: { color: 5793266, name: "Kickstart" },
  ksh: { color: 9035857, name: "Shell" },
  ksy: { color: 7813943, name: "Kaitai Struct" },
  kt: { color: 11107327, icon: "kotlin", name: "Kotlin" },
  ktm: { color: 11107327, icon: "kotlin", name: "Kotlin" },
  kts: { color: 11107327, icon: "kotlin", name: "Kotlin" },
  kv: { color: 1943264, name: "kvlang" },
  l: { color: 15523518, name: "Roff" },
  lagda: { color: 3233381, name: "Agda" },
  langium: { color: 2919559, name: "Langium" },
  lark: { color: 2719929, name: "Lark" },
  las: { color: 10066329, name: "Lasso" },
  lasso: { color: 10066329, name: "Lasso" },
  lasso8: { color: 10066329, name: "Lasso" },
  lasso9: { color: 10066329, name: "Lasso" },
  latte: { color: 15902018, name: "Latte" },
  launch: { color: 24748, name: "XML" },
  lbx: { color: 4022551, name: "TeX" },
  ld: { color: 5793266, name: "Linker Script" },
  lds: { color: 5793266, name: "Linker Script" },
  lean: { color: 5793266, name: "Lean" },
  leex: { color: 14896166, icon: "html", name: "HTML" },
  lektorproject: { color: 13753312, name: "INI" },
  leo: { color: 12910530, name: "Leo" },
  less: { color: 1914461, name: "Less" },
  lex: { color: 14404096, name: "Lex" },
  lfe: { color: 4993059, name: "LFE" },
  lgt: { color: 2710426, name: "Logtalk" },
  lhs: { color: 6180998, name: "Haskell" },
  libsonnet: { color: 25789, name: "Jsonnet" },
  lid: { color: 7102830, name: "Dylan" },
  lidr: { color: 11730944, name: "Idris" },
  ligo: { color: 947455, name: "LigoLANG" },
  linq: { color: 1541632, icon: "csharp", name: "C#" },
  liq: { color: 10027110, name: "Liquidsoap" },
  liquid: { color: 6797534, name: "Liquid" },
  lisp: { color: 8892119, name: "NewLisp" },
  litcoffee: { color: 2377590, name: "CoffeeScript" },
  livecodescript: { color: 809893, name: "LiveCode Script" },
  livemd: { color: 540577, icon: "markdown", name: "Markdown" },
  lkml: { color: 6630273, name: "LookML" },
  ll: { color: 1594905, name: "LLVM" },
  lmi: { color: 3502757, icon: "python", name: "Python" },
  logtalk: { color: 2710426, name: "Logtalk" },
  lol: { color: 13408512, name: "LOLCODE" },
  lookml: { color: 6630273, name: "LookML" },
  lp: { color: 5793266, name: "Linear Programming" },
  lpr: { color: 14938481, name: "Pascal" },
  ls: { color: 5793266, name: "LoomScript" },
  lsl: { color: 4036976, name: "LSL" },
  lslp: { color: 4036976, name: "LSL" },
  lsp: { color: 8892119, name: "NewLisp" },
  ltx: { color: 4022551, name: "TeX" },
  lua: { color: 128, icon: "lua", name: "Lua" },
  luau: { color: 41727, name: "Luau" },
  lvclass: { color: 16702982, name: "LabVIEW" },
  lvlib: { color: 16702982, name: "LabVIEW" },
  lvproj: { color: 16702982, name: "LabVIEW" },
  ly: { color: 10275964, name: "LilyPond" },
  m: { color: 4427519, name: "Objective-C" },
  m2: { color: 14221311, name: "Macaulay2" },
  m3: { color: 2241416, name: "Modula-3" },
  m3u: { color: 1547389, name: "M3U" },
  m3u8: { color: 1547389, name: "M3U" },
  m4: { color: 5793266, name: "M4" },
  ma: { color: 14487808, name: "Wolfram Language" },
  mak: { color: 4356121, name: "Makefile" },
  make: { color: 4356121, name: "Makefile" },
  makefile: { color: 4356121, name: "Makefile" },
  mako: { color: 8291725, name: "Mako" },
  man: { color: 15523518, name: "Roff" },
  mao: { color: 8291725, name: "Mako" },
  markdown: { color: 540577, icon: "markdown", name: "Markdown" },
  marko: { color: 4374514, name: "Marko" },
  mask: { color: 2239543, name: "Unity3D Asset" },
  mat: { color: 2239543, name: "Unity3D Asset" },
  mata: { color: 1728401, name: "Stata" },
  matah: { color: 1728401, name: "Stata" },
  mathematica: { color: 14487808, name: "Wolfram Language" },
  matlab: { color: 14772023, name: "MATLAB" },
  mawk: { color: 12783259, name: "Awk" },
  maxhelp: { color: 12887964, name: "Max" },
  maxpat: { color: 12887964, name: "Max" },
  maxproj: { color: 12887964, name: "Max" },
  mbox: { color: 5793266, name: "E-mail" },
  mbt: { color: 12133249, name: "MoonBit" },
  mc: { color: 5793266, name: "Win32 Message File" },
  mcfunction: { color: 14821431, name: "mcfunction" },
  mch: { color: 9087173, name: "B (Formal Method)" },
  mcmeta: { color: 2697513, name: "JSON" },
  mcr: { color: 42662, name: "MAXScript" },
  md: { color: 540577, icon: "markdown", name: "Markdown" },
  md2: { color: 5793266, name: "Checksums" },
  md4: { color: 5793266, name: "Checksums" },
  md5: { color: 5793266, name: "Checksums" },
  mdoc: { color: 15523518, name: "Roff" },
  mdown: { color: 540577, icon: "markdown", name: "Markdown" },
  mdpolicy: { color: 24748, name: "XML" },
  mdwn: { color: 540577, icon: "markdown", name: "Markdown" },
  mdx: { color: 16560940, name: "MDX" },
  me: { color: 15523518, name: "Roff" },
  mediawiki: { color: 16537431, name: "Wikitext" },
  mermaid: { color: 16725616, name: "Mermaid" },
  meta: { color: 2239543, name: "Unity3D Asset" },
  metal: { color: 9377001, name: "Metal" },
  metta: { color: 6970061, name: "MeTTa" },
  mg: { color: 2241416, name: "Modula-3" },
  minid: { color: 5793266, name: "MiniD" },
  mint: { color: 176198, name: "Mint" },
  mir: { color: 13309726, name: "YAML" },
  mirah: { color: 13084984, name: "Mirah" },
  mjml: { color: 24748, name: "XML" },
  mjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  mk: { color: 4356121, name: "Makefile" },
  mkd: { color: 540577, icon: "markdown", name: "Markdown" },
  mkdn: { color: 540577, icon: "markdown", name: "Markdown" },
  mkdown: { color: 540577, icon: "markdown", name: "Markdown" },
  mkfile: { color: 4356121, name: "Makefile" },
  mkii: { color: 4022551, name: "TeX" },
  mkiv: { color: 4022551, name: "TeX" },
  mkvi: { color: 4022551, name: "TeX" },
  ml: { color: 14440045, name: "Standard ML" },
  ml4: { color: 15694344, name: "OCaml" },
  mli: { color: 15694344, name: "OCaml" },
  mligo: { color: 947455, name: "LigoLANG" },
  mlir: { color: 6211803, name: "MLIR" },
  mll: { color: 15694344, name: "OCaml" },
  mly: { color: 15694344, name: "OCaml" },
  mm: { color: 24748, name: "XML" },
  mmd: { color: 16725616, name: "Mermaid" },
  mmk: { color: 5793266, name: "Module Management System" },
  mms: { color: 5793266, name: "Module Management System" },
  mo: { color: 16494651, name: "Motoko" },
  mod: { color: 24748, name: "XML" },
  mojo: { color: 24748, name: "XML" },
  monkey: { color: 5793266, name: "Monkey" },
  monkey2: { color: 5793266, name: "Monkey" },
  moo: { color: 5793266, name: "Moocode" },
  moon: { color: 16729477, name: "MoonScript" },
  mount: { color: 13753312, name: "INI" },
  move: { color: 4854650, name: "Move" },
  mpl: { color: 2217865, name: "JetBrains MPS" },
  mps: { color: 340141, name: "Mathematical Programming System" },
  mq4: { color: 6465750, name: "MQL4" },
  mq5: { color: 4880056, name: "MQL5" },
  mqh: { color: 4880056, name: "MQL5" },
  mrc: { color: 4020163, name: "mIRC Script" },
  ms: { color: 7228435, name: "Assembly" },
  msd: { color: 2217865, name: "JetBrains MPS" },
  msg: { color: 2240846, name: "ROS Interface" },
  mspec: { color: 7345430, icon: "ruby", name: "Ruby" },
  mss: { color: 5793266, name: "CartoCSS" },
  mt: { color: 14487808, name: "Wolfram Language" },
  mtl: { color: 5793266, name: "Wavefront Material" },
  mtml: { color: 12050932, name: "MTML" },
  mts: { color: 3242182, icon: "typescript", name: "TypeScript" },
  mu: { color: 2378083, name: "mupad" },
  mud: { color: 14448101, name: "ZIL" },
  muf: { color: 3413768, name: "Forth" },
  mumps: { color: 5793266, name: "M" },
  muse: { color: 5793266, name: "Muse" },
  mustache: { color: 7490363, name: "Mustache" },
  mxml: { color: 24748, name: "XML" },
  mxt: { color: 12887964, name: "Max" },
  mysql: { color: 14912512, name: "SQL" },
  myt: { color: 5793266, name: "Myghty" },
  mzn: { color: 436710, name: "MiniZinc" },
  n: { color: 15523518, name: "Roff" },
  nanorc: { color: 13753312, name: "INI" },
  nas: { color: 1911886, name: "Nasal" },
  nasl: { color: 5793266, name: "NASL" },
  nasm: { color: 7228435, name: "Assembly" },
  natvis: { color: 24748, name: "XML" },
  nawk: { color: 12783259, name: "Awk" },
  nb: { color: 14487808, name: "Wolfram Language" },
  nbp: { color: 14487808, name: "Wolfram Language" },
  nc: { color: 9744583, name: "nesC" },
  ncl: { color: 24748, name: "XML" },
  ndproj: { color: 24748, name: "XML" },
  ne: { color: 10027008, name: "Nearley" },
  nearley: { color: 10027008, name: "Nearley" },
  ned: { color: 548988, name: "OMNeT++ NED" },
  neon: { color: 5793266, name: "NEON" },
  network: { color: 13753312, name: "INI" },
  nf: { color: 3851398, name: "Nextflow" },
  nginx: { color: 38457, name: "Nginx" },
  nginxconf: { color: 38457, name: "Nginx" },
  ni: { color: 5793266, name: "Inform 7" },
  nim: { color: 16761344, name: "Nim" },
  "nim.cfg": { color: 16761344, name: "Nim" },
  nimble: { color: 16761344, name: "Nim" },
  nimrod: { color: 16761344, name: "Nim" },
  nims: { color: 16761344, name: "Nim" },
  ninja: { color: 5793266, name: "Ninja" },
  nit: { color: 39191, name: "Nit" },
  nix: { color: 8290047, name: "Nix" },
  njk: { color: 4030775, name: "Nunjucks" },
  njs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  nl: { color: 8892119, name: "NewLisp" },
  nlogo: { color: 16737141, name: "NetLogo" },
  no: { color: 5793266, name: "Text" },
  nomad: { color: 8671162, name: "HCL" },
  nproj: { color: 24748, name: "XML" },
  nqp: { color: 251, name: "Raku" },
  nr: { color: 15523518, name: "Roff" },
  nse: { color: 128, icon: "lua", name: "Lua" },
  nsh: { color: 5793266, name: "NSIS" },
  nsi: { color: 5793266, name: "NSIS" },
  nss: { color: 1119522, name: "NWScript" },
  nu: { color: 5150982, name: "Nushell" },
  numpy: { color: 3502757, icon: "python", name: "Python" },
  numpyw: { color: 3502757, icon: "python", name: "Python" },
  numsc: { color: 3502757, icon: "python", name: "Python" },
  nuspec: { color: 24748, name: "XML" },
  nut: { color: 8388608, name: "Squirrel" },
  ny: { color: 4175499, name: "Common Lisp" },
  ob2: { color: 5793266, name: "Oberon" },
  obj: { color: 5793266, name: "Wavefront Object" },
  objdump: { color: 5793266, name: "ObjDump" },
  odd: { color: 24748, name: "XML" },
  odin: { color: 6336510, name: "Odin" },
  ol: { color: 8663417, name: "Jolie" },
  omgrofl: { color: 13286399, name: "Omgrofl" },
  ooc: { color: 11581310, name: "ooc" },
  opa: { color: 5793266, name: "Opa" },
  opal: { color: 16248288, name: "Opal" },
  opencl: { color: 5592405, name: "C" },
  opy: { color: 7910229, name: "OverPy" },
  orc: { color: 1710618, name: "Csound" },
  org: { color: 7842457, name: "Org" },
  os: { color: 8473804, name: "1C Enterprise" },
  osm: { color: 24748, name: "XML" },
  outjob: { color: 11048547, name: "Altium Designer" },
  overpassql: { color: 13427370, name: "OverpassQL" },
  owl: { color: 5992637, name: "Web Ontology Language" },
  ox: { color: 5793266, name: "Ox" },
  oxh: { color: 5793266, name: "Ox" },
  oxo: { color: 5793266, name: "Ox" },
  oxygene: { color: 13488355, name: "Oxygene" },
  oz: { color: 16430904, name: "Oz" },
  p: { color: 6088192, name: "OpenEdge ABL" },
  p4: { color: 7361973, name: "P4" },
  p6: { color: 251, name: "Raku" },
  p6l: { color: 251, name: "Raku" },
  p6m: { color: 251, name: "Raku" },
  p8: { color: 128, icon: "lua", name: "Lua" },
  pac: { color: 15851610, icon: "javascript", name: "JavaScript" },
  pact: { color: 16230584, name: "Pact" },
  pan: { color: 13369344, name: "Pan" },
  parrot: { color: 15976970, name: "Parrot" },
  pas: { color: 14938481, name: "Pascal" },
  pascal: { color: 14938481, name: "Pascal" },
  pasm: { color: 15976970, name: "Parrot" },
  pat: { color: 12887964, name: "Max" },
  patch: { color: 5793266, name: "Diff" },
  pb: { color: 5925254, name: "PureBasic" },
  pbi: { color: 5925254, name: "PureBasic" },
  pbt: { color: 5793266, name: "Protocol Buffer Text Format" },
  pbtxt: { color: 5793266, name: "Protocol Buffer Text Format" },
  pc: { color: 2842242, name: "pkg-config" },
  "pc.in": { color: 2842242, name: "pkg-config" },
  pcbdoc: { color: 11048547, name: "Altium Designer" },
  pck: { color: 14342360, name: "PLSQL" },
  pcss: { color: 6697881, icon: "css", name: "CSS" },
  pd: { color: 5793266, name: "Pure Data" },
  pd_lua: { color: 128, icon: "lua", name: "Lua" },
  pddl: { color: 852223, name: "PDDL" },
  pde: { color: 38616, name: "Processing" },
  peggy: { color: 2313579, name: "PEG.js" },
  pegjs: { color: 2313579, name: "PEG.js" },
  pep: { color: 13070171, name: "Pep8" },
  per: { color: 14212921, name: "Genero per" },
  perl: { color: 170179, name: "Perl" },
  pfa: { color: 14297372, name: "PostScript" },
  pgsql: { color: 3368848, name: "PLpgSQL" },
  ph: { color: 170179, name: "Perl" },
  php: { color: 5201301, icon: "php", name: "PHP" },
  php3: { color: 5201301, icon: "php", name: "PHP" },
  php4: { color: 5201301, icon: "php", name: "PHP" },
  php5: { color: 5201301, icon: "php", name: "PHP" },
  phps: { color: 5201301, icon: "php", name: "PHP" },
  phpt: { color: 5201301, icon: "php", name: "PHP" },
  phtml: { color: 14896166, icon: "html", name: "HTML" },
  pic: { color: 15523518, name: "Roff" },
  pig: { color: 16570334, name: "PigLatin" },
  pike: { color: 21392, name: "Pike" },
  pir: { color: 15976970, name: "Parrot" },
  pkb: { color: 14342360, name: "PLSQL" },
  pkgproj: { color: 24748, name: "XML" },
  pkl: { color: 7050563, name: "Pkl" },
  pks: { color: 14342360, name: "PLSQL" },
  pl: { color: 170179, name: "Perl" },
  pl6: { color: 251, name: "Raku" },
  plantuml: { color: 16497942, name: "PlantUML" },
  plb: { color: 14342360, name: "PLSQL" },
  plist: { color: 24748, name: "XML" },
  plot: { color: 15772144, name: "Gnuplot" },
  pls: { color: 14342360, name: "PLSQL" },
  plsql: { color: 14342360, name: "PLSQL" },
  plt: { color: 7612476, name: "Prolog" },
  pluginspec: { color: 24748, name: "XML" },
  plx: { color: 170179, name: "Perl" },
  pm: { color: 5592405, name: "C" },
  pm6: { color: 251, name: "Raku" },
  pml: { color: 14548992, name: "Promela" },
  pmod: { color: 21392, name: "Pike" },
  po: { color: 5793266, name: "Gettext Catalog" },
  pod: { color: 5793266, name: "Pod 6" },
  pod6: { color: 5793266, name: "Pod 6" },
  podsl: { color: 4175499, name: "Common Lisp" },
  podspec: { color: 7345430, icon: "ruby", name: "Ruby" },
  pogo: { color: 14155892, name: "PogoScript" },
  polar: { color: 11436543, name: "Polar" },
  pony: { color: 5793266, name: "Pony" },
  por: { color: 16301312, name: "Portugol" },
  postcss: { color: 6697881, icon: "css", name: "CSS" },
  pot: { color: 5793266, name: "Gettext Catalog" },
  pov: { color: 7056485, name: "POV-Ray SDL" },
  pp: { color: 3156845, name: "Puppet" },
  pprx: { color: 14224905, name: "REXX" },
  praat: { color: 13127789, name: "Praat" },
  prawn: { color: 7345430, icon: "ruby", name: "Ruby" },
  prc: { color: 14912512, name: "SQL" },
  prefab: { color: 2239543, name: "Unity3D Asset" },
  prefs: { color: 13753312, name: "INI" },
  prg: { color: 4209216, name: "xBase" },
  pri: { color: 5793266, name: "QMake" },
  prisma: { color: 799819, name: "Prisma" },
  prjpcb: { color: 11048547, name: "Altium Designer" },
  pro: { color: 5793266, name: "QMake" },
  proj: { color: 24748, name: "XML" },
  prolog: { color: 7612476, name: "Prolog" },
  properties: { color: 2777719, name: "Java Properties" },
  props: { color: 24748, name: "XML" },
  proto: { color: 5793266, name: "Protocol Buffer" },
  prw: { color: 4209216, name: "xBase" },
  ps: { color: 14297372, name: "PostScript" },
  ps1: { color: 74838, name: "PowerShell" },
  ps1xml: { color: 24748, name: "XML" },
  psc: { color: 6684876, name: "Papyrus" },
  psc1: { color: 24748, name: "XML" },
  psd1: { color: 74838, name: "PowerShell" },
  psgi: { color: 170179, name: "Perl" },
  psm1: { color: 74838, name: "PowerShell" },
  pt: { color: 24748, name: "XML" },
  pub: { color: 5793266, name: "Public Key" },
  pubxml: { color: 24748, name: "XML" },
  pug: { color: 11035732, name: "Pug" },
  puml: { color: 16497942, name: "PlantUML" },
  purs: { color: 1909293, name: "PureScript" },
  pwn: { color: 14398084, name: "Pawn" },
  pxd: { color: 16703323, name: "Cython" },
  pxi: { color: 16703323, name: "Cython" },
  py: { color: 3502757, icon: "python", name: "Python" },
  py3: { color: 3502757, icon: "python", name: "Python" },
  pyde: { color: 3502757, icon: "python", name: "Python" },
  pyi: { color: 3502757, icon: "python", name: "Python" },
  pyp: { color: 3502757, icon: "python", name: "Python" },
  pyt: { color: 3502757, icon: "python", name: "Python" },
  pytb: { color: 3502757, icon: "python", name: "Python" },
  pyw: { color: 3502757, icon: "python", name: "Python" },
  pyx: { color: 16703323, name: "Cython" },
  q: { color: 16589, name: "q" },
  qasm: { color: 11170047, name: "OpenQASM" },
  qbs: { color: 4498716, name: "QML" },
  qc: { color: 9918327, name: "QuakeC" },
  qhelp: { color: 24748, name: "XML" },
  ql: { color: 1314630, name: "CodeQL" },
  qll: { color: 1314630, name: "CodeQL" },
  qmd: { color: 1674471, name: "RMarkdown" },
  qml: { color: 4498716, name: "QML" },
  qnt: { color: 10317029, name: "Quint" },
  qs: { color: 47169, name: "Qt Script" },
  r: { color: 1674471, name: "R" },
  r2: { color: 3508827, name: "Rebol" },
  r3: { color: 3508827, name: "Rebol" },
  rabl: { color: 7345430, icon: "ruby", name: "Ruby" },
  rake: { color: 7345430, icon: "ruby", name: "Ruby" },
  raku: { color: 251, name: "Raku" },
  rakumod: { color: 251, name: "Raku" },
  raml: { color: 7854587, name: "RAML" },
  rascript: { color: 2922490, name: "RAScript" },
  raw: { color: 5793266, name: "Raw token data" },
  razor: { color: 14896166, icon: "html", name: "HTML" },
  rb: { color: 7345430, icon: "ruby", name: "Ruby" },
  rbbas: { color: 5793266, name: "REALbasic" },
  rbfrm: { color: 5793266, name: "REALbasic" },
  rbi: { color: 7345430, icon: "ruby", name: "Ruby" },
  rbmnu: { color: 5793266, name: "REALbasic" },
  rbres: { color: 5793266, name: "REALbasic" },
  rbs: { color: 7345430, icon: "ruby", name: "Ruby" },
  rbtbar: { color: 5793266, name: "REALbasic" },
  rbuild: { color: 7345430, icon: "ruby", name: "Ruby" },
  rbuistate: { color: 5793266, name: "REALbasic" },
  rbw: { color: 7345430, icon: "ruby", name: "Ruby" },
  rbx: { color: 7345430, icon: "ruby", name: "Ruby" },
  rbxs: { color: 128, icon: "lua", name: "Lua" },
  rchit: { color: 5670565, name: "GLSL" },
  rd: { color: 1674471, name: "R" },
  rdf: { color: 24748, name: "XML" },
  rdoc: { color: 7345430, name: "RDoc" },
  re: { color: 16734279, name: "Reason" },
  reb: { color: 3508827, name: "Rebol" },
  rebol: { color: 3508827, name: "Rebol" },
  red: { color: 16056320, name: "Red" },
  reds: { color: 16007990, name: "Redscript" },
  reek: { color: 13309726, name: "YAML" },
  reg: { color: 5428735, name: "Windows Registry Entries" },
  regex: { color: 39424, name: "Regular Expression" },
  regexp: { color: 39424, name: "Regular Expression" },
  rego: { color: 8229273, name: "Open Policy Agent" },
  rei: { color: 16734279, name: "Reason" },
  religo: { color: 947455, name: "LigoLANG" },
  res: { color: 24748, name: "XML" },
  resi: { color: 15552593, name: "ReScript" },
  resource: { color: 49333, name: "RobotFramework" },
  rest: { color: 1315860, name: "reStructuredText" },
  "rest.txt": { color: 1315860, name: "reStructuredText" },
  resx: { color: 24748, name: "XML" },
  rex: { color: 14224905, name: "REXX" },
  rexx: { color: 14224905, name: "REXX" },
  rg: { color: 13369480, name: "Rouge" },
  rhtml: { color: 14896166, icon: "html", name: "HTML" },
  ring: { color: 2970827, name: "Ring" },
  riot: { color: 10952265, name: "Riot" },
  rkt: { color: 3955882, name: "Racket" },
  rktd: { color: 3955882, name: "Racket" },
  rktl: { color: 3955882, name: "Racket" },
  rl: { color: 10310144, name: "Ragel" },
  rmd: { color: 1674471, name: "RMarkdown" },
  rmiss: { color: 5670565, name: "GLSL" },
  rnh: { color: 6707790, name: "RUNOFF" },
  rno: { color: 15523518, name: "Roff" },
  rnw: { color: 1674471, name: "Sweave" },
  robot: { color: 49333, name: "RobotFramework" },
  roc: { color: 8141045, name: "Roc" },
  rockspec: { color: 128, icon: "lua", name: "Lua" },
  roff: { color: 15523518, name: "Roff" },
  ron: { color: 10890240, name: "RON" },
  ronn: { color: 540577, icon: "markdown", name: "Markdown" },
  rpgle: { color: 2874913, name: "RPGLE" },
  rpy: { color: 16744319, name: "Ren'Py" },
  rq: { color: 804247, name: "SPARQL" },
  rs: { color: 24748, name: "XML" },
  "rs.in": { color: 14591364, icon: "rust", name: "Rust" },
  rsc: { color: 14563649, name: "RouterOS Script" },
  rsh: { color: 5793266, name: "RenderScript" },
  rss: { color: 24748, name: "XML" },
  rst: { color: 1315860, name: "reStructuredText" },
  "rst.txt": { color: 1315860, name: "reStructuredText" },
  rsx: { color: 1674471, name: "R" },
  rtf: { color: 5793266, name: "Rich Text Format" },
  ru: { color: 7345430, icon: "ruby", name: "Ruby" },
  ruby: { color: 7345430, icon: "ruby", name: "Ruby" },
  rviz: { color: 13309726, name: "YAML" },
  s: { color: 7228435, name: "Assembly" },
  sage: { color: 5793266, name: "Sage" },
  sagews: { color: 5793266, name: "Sage" },
  sail: { color: 2465237, name: "Sail" },
  sarif: { color: 2697513, name: "JSON" },
  sas: { color: 11749686, name: "SAS" },
  sass: { color: 10828656, name: "Sass" },
  sats: { color: 1754656, name: "ATS" },
  sbatch: { color: 9035857, name: "Shell" },
  sbt: { color: 12725568, name: "Scala" },
  sc: { color: 4602123, name: "SuperCollider" },
  scad: { color: 15060293, name: "OpenSCAD" },
  scala: { color: 12725568, name: "Scala" },
  scaml: { color: 12392474, name: "Scaml" },
  scd: { color: 4602123, name: "SuperCollider" },
  sce: { color: 13242145, name: "Scilab" },
  scenic: { color: 16631552, name: "Scenic" },
  sch: { color: 24748, name: "XML" },
  schdoc: { color: 11048547, name: "Altium Designer" },
  sci: { color: 13242145, name: "Scilab" },
  scm: { color: 9348684, name: "Tree-sitter Query" },
  sco: { color: 1710618, name: "Csound Score" },
  scpt: { color: 1056543, name: "AppleScript" },
  scrbl: { color: 3955882, name: "Racket" },
  scss: { color: 12997516, name: "SCSS" },
  scxml: { color: 24748, name: "XML" },
  sdc: { color: 14994584, name: "Tcl" },
  sed: { color: 6601072, name: "sed" },
  self: { color: 358826, name: "Self" },
  service: { color: 13753312, name: "INI" },
  sexp: { color: 4175499, name: "Common Lisp" },
  sfd: { color: 5793266, name: "Spline Font Database" },
  sfproj: { color: 24748, name: "XML" },
  sfv: { color: 5793266, name: "Checksums" },
  sh: { color: 9035857, name: "Shell" },
  "sh-session": { color: 5793266, name: "ShellSession" },
  "sh.in": { color: 9035857, name: "Shell" },
  sha1: { color: 5793266, name: "Checksums" },
  sha2: { color: 5793266, name: "Checksums" },
  sha224: { color: 5793266, name: "Checksums" },
  sha256: { color: 5793266, name: "Checksums" },
  sha256sum: { color: 5793266, name: "Checksums" },
  sha3: { color: 5793266, name: "Checksums" },
  sha384: { color: 5793266, name: "Checksums" },
  sha512: { color: 5793266, name: "Checksums" },
  shader: { color: 2239543, name: "ShaderLab" },
  shen: { color: 1183508, name: "Shen" },
  shproj: { color: 24748, name: "XML" },
  sieve: { color: 5793266, name: "Sieve" },
  sig: { color: 14440045, name: "Standard ML" },
  sj: { color: 16714842, name: "Objective-J" },
  sjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  sl: { color: 32511, name: "Slash" },
  slang: { color: 2080457, name: "Slang" },
  sld: { color: 1985260, name: "Scheme" },
  slim: { color: 2829099, name: "Slim" },
  slint: { color: 2324980, name: "Slint" },
  sln: { color: 5793266, name: "Microsoft Visual Studio Solution" },
  slnlaunch: { color: 2697513, name: "JSON" },
  slnx: { color: 24748, name: "XML" },
  sls: { color: 1985260, name: "Scheme" },
  slurm: { color: 9035857, name: "Shell" },
  sma: { color: 14398084, name: "Pawn" },
  smali: { color: 5793266, name: "Smali" },
  smithy: { color: 12862774, name: "Smithy" },
  smk: { color: 3502757, icon: "python", name: "Python" },
  sml: { color: 14440045, name: "Standard ML" },
  smt: { color: 5793266, name: "SMT" },
  smt2: { color: 5793266, name: "SMT" },
  snakefile: { color: 3502757, icon: "python", name: "Python" },
  snap: { color: 1425939, name: "Jest Snapshot" },
  snip: { color: 1679179, name: "Vim Snippet" },
  snippet: { color: 1679179, name: "Vim Snippet" },
  snippets: { color: 1679179, name: "Vim Snippet" },
  socket: { color: 13753312, name: "INI" },
  sol: { color: 11167558, name: "Solidity" },
  soy: { color: 889999, name: "Closure Templates" },
  sp: { color: 16162333, name: "SourcePawn" },
  sparql: { color: 804247, name: "SPARQL" },
  spc: { color: 14342360, name: "PLSQL" },
  spec: { color: 7345430, icon: "ruby", name: "Ruby" },
  spin: { color: 8364711, name: "Propeller Spin" },
  sps: { color: 1985260, name: "Scheme" },
  sqf: { color: 4144959, name: "SQF" },
  sql: { color: 14912512, name: "TSQL" },
  sqlrpgle: { color: 2874913, name: "RPGLE" },
  sra: { color: 9375629, name: "PowerBuilder" },
  srdf: { color: 24748, name: "XML" },
  srt: { color: 10354945, name: "SubRip Text" },
  sru: { color: 9375629, name: "PowerBuilder" },
  srv: { color: 2240846, name: "ROS Interface" },
  srw: { color: 9375629, name: "PowerBuilder" },
  ss: { color: 1985260, name: "Scheme" },
  ssjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  sss: { color: 3132575, name: "SugarSS" },
  st: { color: 4174671, name: "StringTemplate" },
  stan: { color: 11665693, name: "Stan" },
  star: { color: 7787125, name: "Starlark" },
  sthlp: { color: 1728401, name: "Stata" },
  stl: { color: 3619678, name: "STL" },
  ston: { color: 5859078, name: "Smalltalk" },
  story: { color: 5972067, name: "Gherkin" },
  storyboard: { color: 24748, name: "XML" },
  sttheme: { color: 24748, name: "XML" },
  sty: { color: 4022551, name: "TeX" },
  styl: { color: 16737095, name: "Stylus" },
  sublime_metrics: { color: 2697513, name: "JSON" },
  sublime_session: { color: 2697513, name: "JSON" },
  "sublime-build": { color: 2697513, name: "JSON" },
  "sublime-color-scheme": { color: 2697513, name: "JSON" },
  "sublime-commands": { color: 2697513, name: "JSON" },
  "sublime-completions": { color: 2697513, name: "JSON" },
  "sublime-keymap": { color: 2697513, name: "JSON" },
  "sublime-macro": { color: 2697513, name: "JSON" },
  "sublime-menu": { color: 2697513, name: "JSON" },
  "sublime-mousemap": { color: 2697513, name: "JSON" },
  "sublime-project": { color: 2697513, name: "JSON" },
  "sublime-settings": { color: 2697513, name: "JSON" },
  "sublime-snippet": { color: 24748, name: "XML" },
  "sublime-syntax": { color: 13309726, name: "YAML" },
  "sublime-theme": { color: 2697513, name: "JSON" },
  "sublime-workspace": { color: 2697513, name: "JSON" },
  surql: { color: 16711840, name: "SurrealQL" },
  sv: { color: 14344642, name: "SystemVerilog" },
  svelte: { color: 16727552, name: "Svelte" },
  svg: { color: 16750848, name: "SVG" },
  svh: { color: 14344642, name: "SystemVerilog" },
  svx: { color: 6266528, name: "mdsvex" },
  sw: { color: 24748, name: "XML" },
  swg: { color: 5793266, name: "SWIG" },
  swift: { color: 15749432, icon: "swift", name: "Swift" },
  swig: { color: 5793266, name: "SWIG" },
  syntax: { color: 13309726, name: "YAML" },
  t: { color: 13571115, name: "Turing" },
  tab: { color: 14912512, name: "SQL" },
  tac: { color: 3502757, icon: "python", name: "Python" },
  tact: { color: 4765183, name: "Tact" },
  tag: { color: 11563545, icon: "java", name: "Java" },
  talon: { color: 3355443, name: "Talon" },
  target: { color: 13753312, name: "INI" },
  targets: { color: 24748, name: "XML" },
  tcc: { color: 15944573, icon: "cpp", name: "C++" },
  tcl: { color: 14994584, name: "Tcl" },
  "tcl.in": { color: 14994584, name: "Tcl" },
  tcsh: { color: 9035857, name: "Shell" },
  te: { color: 5793266, name: "SELinux Policy" },
  tea: { color: 5793266, name: "Tea" },
  templ: { color: 6738141, name: "templ" },
  tesc: { color: 5670565, name: "GLSL" },
  tese: { color: 5670565, name: "GLSL" },
  tex: { color: 4022551, name: "TeX" },
  texi: { color: 5793266, name: "Texinfo" },
  texinfo: { color: 5793266, name: "Texinfo" },
  textgrid: { color: 13127789, name: "TextGrid" },
  textile: { color: 16770988, name: "Textile" },
  textproto: { color: 5793266, name: "Protocol Buffer Text Format" },
  tf: { color: 8671162, name: "Terraform" },
  tfstate: { color: 2697513, name: "JSON" },
  "tfstate.backup": { color: 2697513, name: "JSON" },
  tftpl: { color: 8671162, name: "Terraform" },
  tfvars: { color: 8671162, name: "Terraform" },
  thor: { color: 7345430, icon: "ruby", name: "Ruby" },
  thrift: { color: 13705511, name: "Thrift" },
  thy: { color: 16711168, name: "Isabelle" },
  timer: { color: 13753312, name: "INI" },
  tl: { color: 5793266, name: "Type Language" },
  tla: { color: 4915321, name: "TLA" },
  tlv: { color: 12845091, name: "TL-Verilog" },
  tm: { color: 14994584, name: "Tcl" },
  tmac: { color: 15523518, name: "Roff" },
  tmcommand: { color: 24748, name: "XML" },
  tmdl: { color: 15780115, name: "TMDL" },
  tml: { color: 24748, name: "XML" },
  tmlanguage: { color: 24748, name: "XML" },
  tmpl: { color: 44504, name: "Go Template" },
  tmpreferences: { color: 24748, name: "XML" },
  tmsnippet: { color: 24748, name: "XML" },
  tmtheme: { color: 24748, name: "XML" },
  tmux: { color: 9035857, name: "Shell" },
  toc: { color: 16245823, name: "World of Warcraft Addon Data" },
  tofu: { color: 8671162, name: "HCL" },
  toit: { color: 12765691, name: "Toit" },
  toml: { color: 10240545, name: "TOML" },
  "toml.example": { color: 10240545, name: "TOML" },
  tool: { color: 9035857, name: "Shell" },
  topojson: { color: 2697513, name: "JSON" },
  tpb: { color: 14342360, name: "PLSQL" },
  tpl: { color: 15777856, name: "Smarty" },
  tpp: { color: 15944573, icon: "cpp", name: "C++" },
  tps: { color: 14342360, name: "PLSQL" },
  tres: { color: 3495280, name: "Godot Resource" },
  trg: { color: 14342360, name: "PLSQL" },
  trigger: { color: 9035857, name: "Shell" },
  ts: { color: 3242182, icon: "typescript", name: "TypeScript" },
  tscn: { color: 3495280, name: "Godot Resource" },
  "tsconfig.json": { color: 2697513, name: "JSON" },
  tsp: { color: 4863589, name: "TypeSpec" },
  tst: { color: 13242145, name: "Scilab" },
  tsv: { color: 2323270, name: "TSV" },
  tsx: { color: 3242182, icon: "typescript", name: "TypeScript" },
  ttl: { color: 5793266, name: "Turtle" },
  tu: { color: 13571115, name: "Turing" },
  twig: { color: 12701734, name: "Twig" },
  txi: { color: 5793266, name: "Texinfo" },
  txl: { color: 96440, name: "TXL" },
  txt: { color: 1679179, name: "Vim Help File" },
  txtpb: { color: 5793266, name: "Protocol Buffer Text Format" },
  txx: { color: 15944573, icon: "cpp", name: "C++" },
  typ: { color: 24748, name: "XML" },
  uc: { color: 10832973, name: "UnrealScript" },
  udf: { color: 14912512, name: "SQL" },
  udo: { color: 1710618, name: "Csound" },
  ui: { color: 24748, name: "XML" },
  unity: { color: 2239543, name: "Unity3D Asset" },
  uno: { color: 10040268, name: "Uno" },
  upc: { color: 5592405, name: "C" },
  uplc: { color: 3583421, name: "Untyped Plutus Core" },
  ur: { color: 13421806, name: "UrWeb" },
  urdf: { color: 24748, name: "XML" },
  url: { color: 13753312, name: "INI" },
  urs: { color: 13421806, name: "UrWeb" },
  ux: { color: 24748, name: "XML" },
  v: { color: 11712504, name: "Verilog" },
  vala: { color: 10841570, name: "Vala" },
  vapi: { color: 10841570, name: "Vala" },
  vark: { color: 8557439, name: "Gosu" },
  vb: { color: 9723319, name: "Visual Basic .NET" },
  vba: { color: 1679179, name: "Vim Script" },
  vbhtml: { color: 9723319, name: "Visual Basic .NET" },
  vbproj: { color: 24748, name: "XML" },
  vbs: { color: 1432796, name: "VBScript" },
  vcf: { color: 15607367, name: "vCard" },
  vcl: { color: 1346216, name: "VCL" },
  vcxproj: { color: 24748, name: "XML" },
  vdf: { color: 15884325, name: "Valve Data Format" },
  veo: { color: 11712504, name: "Verilog" },
  vert: { color: 5670565, name: "GLSL" },
  vh: { color: 14344642, name: "SystemVerilog" },
  vhd: { color: 11383499, name: "VHDL" },
  vhdl: { color: 11383499, name: "VHDL" },
  vhf: { color: 11383499, name: "VHDL" },
  vhi: { color: 11383499, name: "VHDL" },
  vho: { color: 11383499, name: "VHDL" },
  vhost: { color: 38457, name: "Nginx" },
  vhs: { color: 11383499, name: "VHDL" },
  vht: { color: 11383499, name: "VHDL" },
  vhw: { color: 11383499, name: "VHDL" },
  vim: { color: 1679179, name: "Vim Script" },
  vimrc: { color: 1679179, name: "Vim Script" },
  viw: { color: 14912512, name: "SQL" },
  vmb: { color: 1679179, name: "Vim Script" },
  vmf: { color: 15884325, name: "Valve Data Format" },
  volt: { color: 2039583, name: "Volt" },
  vrx: { color: 5670565, name: "GLSL" },
  vs: { color: 5670565, name: "GLSL" },
  vsh: { color: 5670565, name: "GLSL" },
  vshader: { color: 5670565, name: "GLSL" },
  vsixmanifest: { color: 24748, name: "XML" },
  vssettings: { color: 24748, name: "XML" },
  vstemplate: { color: 24748, name: "XML" },
  vtl: { color: 5274879, name: "Velocity Template Language" },
  vto: { color: 16711808, name: "Vento" },
  vtt: { color: 5793266, name: "WebVTT" },
  vue: { color: 4307075, name: "Vue" },
  vw: { color: 14342360, name: "PLSQL" },
  vxml: { color: 24748, name: "XML" },
  vy: { color: 10439922, name: "Vyper" },
  w: { color: 6088192, name: "OpenEdge ABL" },
  wast: { color: 267067, name: "WebAssembly" },
  wat: { color: 267067, name: "WebAssembly" },
  watchr: { color: 7345430, icon: "ruby", name: "Ruby" },
  wdl: { color: 4387316, name: "WDL" },
  webapp: { color: 2697513, name: "JSON" },
  webidl: { color: 5793266, name: "WebIDL" },
  webmanifest: { color: 2697513, name: "JSON" },
  weechatlog: { color: 5793266, name: "IRC log" },
  wgsl: { color: 1728154, name: "WGSL" },
  whiley: { color: 14009239, name: "Whiley" },
  wiki: { color: 16537431, name: "Wikitext" },
  wikitext: { color: 16537431, name: "Wikitext" },
  wisp: { color: 7701201, name: "wisp" },
  wit: { color: 6443239, name: "WebAssembly Interface Type" },
  wixproj: { color: 24748, name: "XML" },
  wl: { color: 14487808, name: "Wolfram Language" },
  wlk: { color: 10630968, name: "Wollok" },
  wls: { color: 14487808, name: "Wolfram Language" },
  wlt: { color: 14487808, name: "Wolfram Language" },
  wlua: { color: 128, icon: "lua", name: "Lua" },
  workbook: { color: 540577, icon: "markdown", name: "Markdown" },
  workflow: { color: 24748, name: "XML" },
  wren: { color: 3684408, name: "Wren" },
  ws: { color: 16711680, name: "Witcher Script" },
  wsdl: { color: 24748, name: "XML" },
  wsf: { color: 24748, name: "XML" },
  wsgi: { color: 3502757, icon: "python", name: "Python" },
  wxi: { color: 24748, name: "XML" },
  wxl: { color: 24748, name: "XML" },
  wxs: { color: 24748, name: "XML" },
  x: { color: 5793266, name: "RPC" },
  x10: { color: 4942831, name: "X10" },
  x3d: { color: 24748, name: "XML" },
  x68: { color: 7228435, name: "Assembly" },
  xacro: { color: 24748, name: "XML" },
  xaml: { color: 24748, name: "XML" },
  xbm: { color: 5592405, name: "C" },
  xc: { color: 10082823, name: "XC" },
  xdc: { color: 14994584, name: "Tcl" },
  xht: { color: 14896166, icon: "html", name: "HTML" },
  xhtml: { color: 14896166, icon: "html", name: "HTML" },
  xi: { color: 5793266, name: "Logos" },
  xib: { color: 24748, name: "XML" },
  xlf: { color: 24748, name: "XML" },
  xliff: { color: 24748, name: "XML" },
  xm: { color: 5793266, name: "Logos" },
  xmi: { color: 24748, name: "XML" },
  xml: { color: 24748, name: "XML" },
  "xml.dist": { color: 24748, name: "XML" },
  xmp: { color: 24748, name: "XML" },
  xojo_code: { color: 8502593, name: "Xojo" },
  xojo_menu: { color: 8502593, name: "Xojo" },
  xojo_report: { color: 8502593, name: "Xojo" },
  xojo_script: { color: 8502593, name: "Xojo" },
  xojo_toolbar: { color: 8502593, name: "Xojo" },
  xojo_window: { color: 8502593, name: "Xojo" },
  xpl: { color: 5793266, name: "XProc" },
  xpm: { color: 5592405, name: "C" },
  xproc: { color: 5793266, name: "XProc" },
  xproj: { color: 24748, name: "XML" },
  xpy: { color: 3502757, icon: "python", name: "Python" },
  xq: { color: 5386983, name: "XQuery" },
  xql: { color: 5386983, name: "XQuery" },
  xqm: { color: 5386983, name: "XQuery" },
  xquery: { color: 5386983, name: "XQuery" },
  xqy: { color: 5386983, name: "XQuery" },
  xrl: { color: 12073368, name: "Erlang" },
  xs: { color: 5793266, name: "XS" },
  xsd: { color: 24748, name: "XML" },
  xsh: { color: 2645743, name: "Xonsh" },
  xsjs: { color: 15851610, icon: "javascript", name: "JavaScript" },
  xsjslib: { color: 15851610, icon: "javascript", name: "JavaScript" },
  xsl: { color: 15437035, name: "XSLT" },
  xslt: { color: 15437035, name: "XSLT" },
  "xsp-config": { color: 5793266, name: "XPages" },
  "xsp.metadata": { color: 5793266, name: "XPages" },
  xspec: { color: 24748, name: "XML" },
  xtend: { color: 2368861, name: "Xtend" },
  xul: { color: 24748, name: "XML" },
  xzap: { color: 878174, name: "ZAP" },
  y: { color: 4942923, name: "Yacc" },
  yacc: { color: 4942923, name: "Yacc" },
  yaml: { color: 13309726, name: "YAML" },
  "yaml-tmlanguage": { color: 13309726, name: "YAML" },
  "yaml.sed": { color: 13309726, name: "YAML" },
  yang: { color: 5793266, name: "YANG" },
  yap: { color: 7612476, name: "Prolog" },
  yar: { color: 2228224, name: "YARA" },
  yara: { color: 2228224, name: "YARA" },
  yasnippet: { color: 3320720, name: "YASnippet" },
  yml: { color: 13309726, name: "YAML" },
  "yml.mysql": { color: 13309726, name: "YAML" },
  yrl: { color: 12073368, name: "Erlang" },
  yul: { color: 7948594, name: "Yul" },
  yy: { color: 4942923, name: "Yacc" },
  yyp: { color: 2697513, name: "JSON" },
  z3: { color: 5793266, name: "SMT" },
  zap: { color: 878174, name: "ZAP" },
  zcml: { color: 24748, name: "XML" },
  zed: { color: 10826122, name: "SpiceDB Schema" },
  zeek: { color: 5793266, name: "Zeek" },
  zep: { color: 1150878, name: "Zephir" },
  zig: { color: 15503708, name: "Zig" },
  "zig.zon": { color: 15503708, name: "Zig" },
  zil: { color: 14448101, name: "ZIL" },
  zimpl: { color: 14055185, name: "Zimpl" },
  zmodel: { color: 16740608, name: "Zmodel" },
  zmpl: { color: 14055185, name: "Zimpl" },
  zone: { color: 5793266, name: "DNS Zone" },
  zpl: { color: 14055185, name: "Zimpl" },
  zs: { color: 48337, name: "ZenScript" },
  zsh: { color: 9035857, name: "Shell" },
  "zsh-theme": { color: 9035857, name: "Shell" }
};
var LANGUAGE_BY_FILENAME = {
  _curlrc: { color: 13753312, name: "INI" },
  _dir_colors: { color: 5793266, name: "dircolors" },
  _dircolors: { color: 5793266, name: "dircolors" },
  _emacs: { color: 12608987, name: "Emacs Lisp" },
  "_helpers.tpl": { color: 44504, name: "Go Template" },
  _redirects: { color: 5793266, name: "Redirect Rules" },
  _vimrc: { color: 1679179, name: "Vim Script" },
  ".abbrev_defs": { color: 12608987, name: "Emacs Lisp" },
  ".ackrc": { color: 4679474, name: "Option List" },
  ".all-contributorsrc": { color: 2697513, name: "JSON" },
  ".arcconfig": { color: 2697513, name: "JSON" },
  ".atomignore": { color: 5793266, name: "Ignore List" },
  ".auto-changelog": { color: 2697513, name: "JSON" },
  ".babelignore": { color: 5793266, name: "Ignore List" },
  ".babelrc": { color: 2697513, name: "JSON" },
  ".bash_aliases": { color: 9035857, name: "Shell" },
  ".bash_functions": { color: 9035857, name: "Shell" },
  ".bash_history": { color: 9035857, name: "Shell" },
  ".bash_logout": { color: 9035857, name: "Shell" },
  ".bash_profile": { color: 9035857, name: "Shell" },
  ".bashrc": { color: 9035857, name: "Shell" },
  ".browserslistrc": { color: 16766265, name: "Browserslist" },
  ".buckconfig": { color: 13753312, name: "INI" },
  ".bzrignore": { color: 5793266, name: "Ignore List" },
  ".c8rc": { color: 2697513, name: "JSON" },
  ".clang-format": { color: 13309726, name: "YAML" },
  ".clang-tidy": { color: 13309726, name: "YAML" },
  ".clangd": { color: 13309726, name: "YAML" },
  ".classpath": { color: 24748, name: "XML" },
  ".coffeelintignore": { color: 5793266, name: "Ignore List" },
  ".coveragerc": { color: 13753312, name: "INI" },
  ".cproject": { color: 24748, name: "XML" },
  ".cshrc": { color: 9035857, name: "Shell" },
  ".curlrc": { color: 13753312, name: "INI" },
  ".cvsignore": { color: 5793266, name: "Ignore List" },
  ".devcontainer.json": { color: 2697513, name: "JSON" },
  ".dir_colors": { color: 5793266, name: "dircolors" },
  ".dircolors": { color: 5793266, name: "dircolors" },
  ".dockerignore": { color: 5793266, name: "Ignore List" },
  ".easignore": { color: 5793266, name: "Ignore List" },
  ".editorconfig": { color: 13753312, name: "INI" },
  ".eleventyignore": { color: 5793266, name: "Ignore List" },
  ".emacs": { color: 12608987, name: "Emacs Lisp" },
  ".emacs.desktop": { color: 12608987, name: "Emacs Lisp" },
  ".env": { color: 15062361, name: "Dotenv" },
  ".env.ci": { color: 15062361, name: "Dotenv" },
  ".env.dev": { color: 15062361, name: "Dotenv" },
  ".env.development": { color: 15062361, name: "Dotenv" },
  ".env.development.local": { color: 15062361, name: "Dotenv" },
  ".env.example": { color: 15062361, name: "Dotenv" },
  ".env.local": { color: 15062361, name: "Dotenv" },
  ".env.prod": { color: 15062361, name: "Dotenv" },
  ".env.production": { color: 15062361, name: "Dotenv" },
  ".env.sample": { color: 15062361, name: "Dotenv" },
  ".env.staging": { color: 15062361, name: "Dotenv" },
  ".env.template": { color: 15062361, name: "Dotenv" },
  ".env.test": { color: 15062361, name: "Dotenv" },
  ".env.testing": { color: 15062361, name: "Dotenv" },
  ".envrc": { color: 9035857, name: "Shell" },
  ".eslint-ignore": { color: 5793266, name: "Ignore List" },
  ".eslintignore": { color: 5793266, name: "Ignore List" },
  ".eslintrc.json": { color: 2697513, name: "JSON" },
  ".exrc": { color: 1679179, name: "Vim Script" },
  ".factor-boot-rc": { color: 6514502, name: "Factor" },
  ".factor-rc": { color: 6514502, name: "Factor" },
  ".flake8": { color: 13753312, name: "INI" },
  ".flaskenv": { color: 9035857, name: "Shell" },
  ".gclient": { color: 3502757, icon: "python", name: "Python" },
  ".gemrc": { color: 13309726, name: "YAML" },
  ".git-blame-ignore-revs": { color: 16010535, name: "Git Revision List" },
  ".gitattributes": { color: 16010535, name: "Git Attributes" },
  ".gitconfig": { color: 13753312, name: "INI" },
  ".gitignore": { color: 5793266, name: "Ignore List" },
  ".gitmodules": { color: 13753312, name: "INI" },
  ".gn": { color: 5793266, name: "GN" },
  ".gnus": { color: 12608987, name: "Emacs Lisp" },
  ".gvimrc": { color: 1679179, name: "Vim Script" },
  ".htaccess": { color: 13705511, name: "ApacheConf" },
  ".htmlhintrc": { color: 2697513, name: "JSON" },
  ".ignore": { color: 5793266, name: "Ignore List" },
  ".imgbotconfig": { color: 2697513, name: "JSON" },
  ".inputrc": { color: 13753312, name: "INI" },
  ".irbrc": { color: 7345430, icon: "ruby", name: "Ruby" },
  ".jscsrc": { color: 2697513, name: "JSON" },
  ".jshintrc": { color: 2697513, name: "JSON" },
  ".jslintrc": { color: 2697513, name: "JSON" },
  ".justfile": { color: 3689812, name: "Just" },
  ".kshrc": { color: 9035857, name: "Shell" },
  ".latexmkrc": { color: 170179, name: "Perl" },
  ".login": { color: 9035857, name: "Shell" },
  ".luacheckrc": { color: 128, icon: "lua", name: "Lua" },
  ".markdownlintignore": { color: 5793266, name: "Ignore List" },
  ".nanorc": { color: 13753312, name: "INI" },
  ".nodemonignore": { color: 5793266, name: "Ignore List" },
  ".npmignore": { color: 5793266, name: "Ignore List" },
  ".npmrc": { color: 13753312, name: "INI" },
  ".nvimrc": { color: 1679179, name: "Vim Script" },
  ".nycrc": { color: 2697513, name: "JSON" },
  ".oxlintrc.json": { color: 2697513, name: "JSON" },
  ".php": { color: 5201301, icon: "php", name: "PHP" },
  ".php_cs": { color: 5201301, icon: "php", name: "PHP" },
  ".php_cs.dist": { color: 5201301, icon: "php", name: "PHP" },
  ".prettierignore": { color: 5793266, name: "Ignore List" },
  ".profile": { color: 9035857, name: "Shell" },
  ".project": { color: 24748, name: "XML" },
  ".pryrc": { color: 7345430, icon: "ruby", name: "Ruby" },
  ".pylintrc": { color: 13753312, name: "INI" },
  ".rprofile": { color: 1674471, name: "R" },
  ".rspec": { color: 4679474, name: "Option List" },
  ".scalafix.conf": { color: 10483950, name: "HOCON" },
  ".scalafmt.conf": { color: 10483950, name: "HOCON" },
  ".shellcheckrc": { color: 13553611, name: "ShellCheck Config" },
  ".simplecov": { color: 7345430, icon: "ruby", name: "Ruby" },
  ".spacemacs": { color: 12608987, name: "Emacs Lisp" },
  ".stylelintignore": { color: 5793266, name: "Ignore List" },
  ".swcrc": { color: 2697513, name: "JSON" },
  ".tern-config": { color: 2697513, name: "JSON" },
  ".tern-project": { color: 2697513, name: "JSON" },
  ".tm_properties": { color: 14640868, name: "TextMate Properties" },
  ".tmux.conf": { color: 9035857, name: "Shell" },
  ".vercelignore": { color: 5793266, name: "Ignore List" },
  ".vimrc": { color: 1679179, name: "Vim Script" },
  ".viper": { color: 12608987, name: "Emacs Lisp" },
  ".vscodeignore": { color: 5793266, name: "Ignore List" },
  ".watchmanconfig": { color: 2697513, name: "JSON" },
  ".wgetrc": { color: 13753312, name: "INI" },
  ".xcompose": { color: 5793266, name: "XCompose" },
  ".xinitrc": { color: 9035857, name: "Shell" },
  ".xsession": { color: 9035857, name: "Shell" },
  ".yardopts": { color: 4679474, name: "Option List" },
  ".zlogin": { color: 9035857, name: "Shell" },
  ".zlogout": { color: 9035857, name: "Shell" },
  ".zprofile": { color: 9035857, name: "Shell" },
  ".zshenv": { color: 9035857, name: "Shell" },
  ".zshrc": { color: 9035857, name: "Shell" },
  "9fs": { color: 9035857, name: "Shell" },
  abbrev_defs: { color: 12608987, name: "Emacs Lisp" },
  ack: { color: 170179, name: "Perl" },
  ackrc: { color: 4679474, name: "Option List" },
  "android.bp": { color: 5793266, name: "Soong" },
  "ant.xml": { color: 11081086, name: "Ant Build System" },
  "apache2.conf": { color: 13705511, name: "ApacheConf" },
  "api-extractor.json": { color: 2697513, name: "JSON" },
  apkbuild: { color: 9035857, name: "Shell" },
  "app.config": { color: 24748, name: "XML" },
  appraisals: { color: 7345430, icon: "ruby", name: "Ruby" },
  bash_aliases: { color: 9035857, name: "Shell" },
  bash_logout: { color: 9035857, name: "Shell" },
  bash_profile: { color: 9035857, name: "Shell" },
  bashrc: { color: 9035857, name: "Shell" },
  berksfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  brewfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  browserslist: { color: 16766265, name: "Browserslist" },
  bsdmakefile: { color: 4356121, name: "Makefile" },
  buck: { color: 7787125, name: "Starlark" },
  build: { color: 7787125, name: "Starlark" },
  "build.bazel": { color: 7787125, name: "Starlark" },
  "build.xml": { color: 11081086, name: "Ant Build System" },
  buildfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "buildozer.spec": { color: 13753312, name: "INI" },
  "bun.lock": { color: 16380385, name: "Bun" },
  "cabal.config": { color: 4732005, name: "Cabal Config" },
  "cabal.project": { color: 4732005, name: "Cabal Config" },
  caddyfile: { color: 2274872, name: "Caddyfile" },
  cakefile: { color: 2377590, name: "CoffeeScript" },
  capfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "cargo.lock": { color: 14591364, icon: "rust", name: "Rust" },
  "cargo.toml": { color: 14591364, icon: "rust", name: "Rust" },
  "cargo.toml.orig": { color: 10240545, name: "TOML" },
  cask: { color: 12608987, name: "Emacs Lisp" },
  "checksums.txt": { color: 5793266, name: "Checksums" },
  citation: { color: 5793266, name: "Text" },
  "citation.cff": { color: 13309726, name: "YAML" },
  citations: { color: 5793266, name: "Text" },
  cksums: { color: 5793266, name: "Checksums" },
  "click.me": { color: 5793266, name: "Text" },
  "cmakelists.txt": { color: 14300212, name: "CMake" },
  codeowners: { color: 5793266, name: "CODEOWNERS" },
  commit_editmsg: { color: 16010535, name: "Git Commit" },
  "composer.json": { color: 5201301, icon: "php", name: "PHP" },
  "composer.lock": { color: 2697513, name: "JSON" },
  "configure.ac": { color: 5793266, name: "M4" },
  containerfile: { color: 3689812, name: "Dockerfile" },
  "contents.lr": { color: 540577, icon: "markdown", name: "Markdown" },
  copying: { color: 5793266, name: "Text" },
  "copying.regex": { color: 5793266, name: "Text" },
  "copyright.regex": { color: 5793266, name: "Text" },
  cpanfile: { color: 170179, name: "Perl" },
  crontab: { color: 15390636, name: "crontab" },
  cshrc: { color: 9035857, name: "Shell" },
  dangerfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "delete.me": { color: 5793266, name: "Text" },
  deliverfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "deno.lock": { color: 2697513, name: "JSON" },
  deps: { color: 3502757, icon: "python", name: "Python" },
  "descrip.mmk": { color: 5793266, name: "Module Management System" },
  "descrip.mms": { color: 5793266, name: "Module Management System" },
  "dev-requirements.txt": { color: 16765763, name: "Pip Requirements" },
  "devcontainer.json": { color: 2697513, name: "JSON" },
  dir_colors: { color: 5793266, name: "dircolors" },
  dockerfile: { color: 3689812, name: "Dockerfile" },
  "dune-project": { color: 8995358, name: "Dune" },
  earthfile: { color: 2814207, name: "Earthly" },
  eask: { color: 12608987, name: "Emacs Lisp" },
  emakefile: { color: 12073368, name: "Erlang" },
  "encodings.dir": { color: 5793266, name: "X Font Directory Index" },
  eqnrc: { color: 15523518, name: "Roff" },
  "expr-dist": { color: 1674471, name: "R" },
  fakefile: { color: 8101300, name: "Fancy" },
  fastfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  file_contexts: { color: 5793266, name: "SELinux Policy" },
  "firestore.rules": { color: 16752640, name: "Cloud Firestore Security Rules" },
  "flake.lock": { color: 2697513, name: "JSON" },
  fontlog: { color: 5793266, name: "Text" },
  "fonts.alias": { color: 5793266, name: "X Font Directory Index" },
  "fonts.dir": { color: 5793266, name: "X Font Directory Index" },
  "fonts.scale": { color: 5793266, name: "X Font Directory Index" },
  "fp-lib-table": { color: 3099307, name: "KiCad Layout" },
  gemfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "gemfile.lock": { color: 7345430, name: "Gemfile.lock" },
  genfs_contexts: { color: 5793266, name: "SELinux Policy" },
  gitignore_global: { color: 5793266, name: "Ignore List" },
  "gitignore-global": { color: 5793266, name: "Ignore List" },
  "glide.lock": { color: 13309726, name: "YAML" },
  gnumakefile: { color: 4356121, name: "Makefile" },
  "go.mod": { color: 44504, icon: "go", name: "Go" },
  "go.sum": { color: 44504, icon: "go", name: "Go" },
  "go.work": { color: 44504, name: "Go Workspace" },
  "go.work.sum": { color: 44504, name: "Go Checksums" },
  "gopkg.lock": { color: 10240545, name: "TOML" },
  gradlew: { color: 9035857, name: "Shell" },
  "gradlew.bat": { color: 12710190, name: "Batchfile" },
  gtkrc: { color: 8382233, name: "GtkRC" },
  "gtkrc-2.0": { color: 8382233, name: "GtkRC" },
  guardfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  gvimrc: { color: 1679179, name: "Vim Script" },
  "haproxy.cfg": { color: 1076649, name: "HAProxy" },
  hosts: { color: 13753312, name: "INI" },
  "hosts.txt": { color: 3180680, name: "Hosts File" },
  "httpd.conf": { color: 13705511, name: "ApacheConf" },
  initial_sids: { color: 5793266, name: "SELinux Policy" },
  inputrc: { color: 13753312, name: "INI" },
  install: { color: 5793266, name: "Text" },
  "install.mysql": { color: 5793266, name: "Text" },
  "installscript.qs": { color: 47169, name: "Qt Script" },
  jakefile: { color: 15851610, icon: "javascript", name: "JavaScript" },
  jarfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  jenkinsfile: { color: 4364472, name: "Groovy" },
  "jsconfig.json": { color: 2697513, name: "JSON" },
  justfile: { color: 3689812, name: "Just" },
  kakrc: { color: 7307330, name: "KakouneScript" },
  kbuild: { color: 4356121, name: "Makefile" },
  "kcl.mod": { color: 8043199, name: "KCL" },
  "kcl.mod.lock": { color: 8043199, name: "KCL" },
  "keep.me": { color: 5793266, name: "Text" },
  kshrc: { color: 9035857, name: "Shell" },
  "language-configuration.json": { color: 2697513, name: "JSON" },
  "language-subtag-registry.txt": { color: 422842, name: "Record Jar" },
  latexmkrc: { color: 170179, name: "Perl" },
  "ld.script": { color: 5793266, name: "Linker Script" },
  "lexer.x": { color: 14404096, name: "Lex" },
  license: { color: 5793266, name: "Text" },
  "license.mysql": { color: 5793266, name: "Text" },
  login: { color: 9035857, name: "Shell" },
  m3makefile: { color: 8921651, name: "Quake" },
  m3overrides: { color: 8921651, name: "Quake" },
  makefile: { color: 4356121, name: "Makefile" },
  "makefile.am": { color: 4356121, name: "Makefile" },
  "makefile.boot": { color: 4356121, name: "Makefile" },
  "makefile.frag": { color: 4356121, name: "Makefile" },
  "makefile.in": { color: 4356121, name: "Makefile" },
  "makefile.inc": { color: 4356121, name: "Makefile" },
  "makefile.pc": { color: 4356121, name: "Makefile" },
  "makefile.pl": { color: 170179, name: "Perl" },
  "makefile.sco": { color: 4356121, name: "Makefile" },
  "makefile.wat": { color: 4356121, name: "Makefile" },
  man: { color: 9035857, name: "Shell" },
  "manifest.mf": { color: 11563545, name: "JAR Manifest" },
  mavenfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "mcmod.info": { color: 2697513, name: "JSON" },
  "md5sum.txt": { color: 5793266, name: "Checksums" },
  md5sums: { color: 5793266, name: "Checksums" },
  "meson_options.txt": { color: 30720, name: "Meson" },
  "meson.build": { color: 30720, name: "Meson" },
  "mise.local.lock": { color: 10240545, name: "TOML" },
  "mise.lock": { color: 10240545, name: "TOML" },
  "mix.lock": { color: 7228030, name: "Elixir" },
  mkfile: { color: 4356121, name: "Makefile" },
  mmn: { color: 15523518, name: "Roff" },
  mmt: { color: 15523518, name: "Roff" },
  "mocha.opts": { color: 4679474, name: "Option List" },
  "module.bazel": { color: 7787125, name: "Starlark" },
  "module.bazel.lock": { color: 2697513, name: "JSON" },
  modulefile: { color: 3156845, name: "Puppet" },
  mvnw: { color: 9035857, name: "Shell" },
  "mvnw.cmd": { color: 12710190, name: "Batchfile" },
  nanorc: { color: 13753312, name: "INI" },
  news: { color: 5793266, name: "Text" },
  "nextflow.config": { color: 3851398, name: "Nextflow" },
  "nginx.conf": { color: 38457, name: "Nginx" },
  "nim.cfg": { color: 16761344, name: "Nim" },
  notebook: { color: 14310155, name: "Jupyter Notebook" },
  "nuget.config": { color: 24748, name: "XML" },
  nukefile: { color: 13229888, name: "Nu" },
  nvimrc: { color: 1679179, name: "Vim Script" },
  owh: { color: 14994584, name: "Tcl" },
  "package-lock.json": { color: 15851610, icon: "javascript", name: "JavaScript" },
  "package.json": { color: 15851610, icon: "javascript", name: "JavaScript" },
  "package.mask": { color: 5793266, name: "Text" },
  "package.resolved": { color: 2697513, name: "JSON" },
  "package.use.mask": { color: 5793266, name: "Text" },
  "package.use.stable.mask": { color: 5793266, name: "Text" },
  "packages.config": { color: 24748, name: "XML" },
  "pdm.lock": { color: 10240545, name: "TOML" },
  phakefile: { color: 5201301, icon: "php", name: "PHP" },
  pipfile: { color: 10240545, name: "TOML" },
  "pipfile.lock": { color: 2697513, name: "JSON" },
  "pixi.lock": { color: 13309726, name: "YAML" },
  pkgbuild: { color: 9035857, name: "Shell" },
  podfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "poetry.lock": { color: 10240545, name: "TOML" },
  "pom.xml": { color: 11563545, icon: "java", name: "Java" },
  port_contexts: { color: 5793266, name: "SELinux Policy" },
  procfile: { color: 3878755, name: "Procfile" },
  profile: { color: 9035857, name: "Shell" },
  "project.ede": { color: 12608987, name: "Emacs Lisp" },
  "project.godot": { color: 3495280, name: "Godot Resource" },
  puppetfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  pylintrc: { color: 13753312, name: "INI" },
  "pyproject.toml": { color: 3502757, icon: "python", name: "Python" },
  rakefile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "read.me": { color: 5793266, name: "Text" },
  "readme.1st": { color: 5793266, name: "Text" },
  "readme.me": { color: 5793266, name: "Text" },
  "readme.mysql": { color: 5793266, name: "Text" },
  "readme.nss": { color: 5793266, name: "Text" },
  "readme.pc": { color: 5793266, name: "Text" },
  "rebar.config": { color: 12073368, name: "Erlang" },
  "rebar.config.lock": { color: 12073368, name: "Erlang" },
  "rebar.lock": { color: 12073368, name: "Erlang" },
  "requirements-dev.txt": { color: 16765763, name: "Pip Requirements" },
  "requirements.lock.txt": { color: 16765763, name: "Pip Requirements" },
  "requirements.txt": { color: 3502757, icon: "python", name: "Python" },
  rexfile: { color: 170179, name: "Perl" },
  "riemann.config": { color: 14374997, name: "Clojure" },
  "robots.txt": { color: 5793266, name: "Robots Exclusion Rules" },
  root: { color: 16711168, name: "Isabelle" },
  sconscript: { color: 3502757, icon: "python", name: "Python" },
  sconstruct: { color: 3502757, icon: "python", name: "Python" },
  security_classes: { color: 5793266, name: "SELinux Policy" },
  "settings.stylecop": { color: 24748, name: "XML" },
  sha1sums: { color: 5793266, name: "Checksums" },
  sha256sums: { color: 5793266, name: "Checksums" },
  "sha256sums.txt": { color: 5793266, name: "Checksums" },
  sha512sums: { color: 5793266, name: "Checksums" },
  singularity: { color: 6612653, name: "Singularity" },
  slakefile: { color: 4823174, name: "LiveScript" },
  snakefile: { color: 3502757, icon: "python", name: "Python" },
  snapfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  ssh_config: { color: 13753312, name: "INI" },
  "ssh-config": { color: 13753312, name: "INI" },
  sshconfig: { color: 13753312, name: "INI" },
  "sshconfig.snip": { color: 13753312, name: "INI" },
  sshd_config: { color: 13753312, name: "INI" },
  "sshd-config": { color: 13753312, name: "INI" },
  starfield: { color: 14994584, name: "Tcl" },
  steepfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  "suite.rc": { color: 13753312, name: "INI" },
  "test.me": { color: 5793266, name: "Text" },
  thorfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  tiltfile: { color: 7787125, name: "Starlark" },
  "tmux.conf": { color: 9035857, name: "Shell" },
  "toolchain_installscript.qs": { color: 47169, name: "Qt Script" },
  torrc: { color: 5845355, name: "Tor Config" },
  troffrc: { color: 15523518, name: "Roff" },
  "troffrc-end": { color: 15523518, name: "Roff" },
  "tsconfig.json": { color: 3242182, icon: "typescript", name: "TypeScript" },
  "tslint.json": { color: 2697513, name: "JSON" },
  "use.mask": { color: 5793266, name: "Text" },
  "use.stable.mask": { color: 5793266, name: "Text" },
  "uv.lock": { color: 10240545, name: "TOML" },
  vagrantfile: { color: 7345430, icon: "ruby", name: "Ruby" },
  vimrc: { color: 1679179, name: "Vim Script" },
  vlcrc: { color: 13753312, name: "INI" },
  "web.config": { color: 24748, name: "XML" },
  "web.debug.config": { color: 24748, name: "XML" },
  "web.release.config": { color: 24748, name: "XML" },
  workspace: { color: 7787125, name: "Starlark" },
  "workspace.bazel": { color: 7787125, name: "Starlark" },
  "workspace.bzlmod": { color: 7787125, name: "Starlark" },
  wscript: { color: 3502757, icon: "python", name: "Python" },
  xcompose: { color: 5793266, name: "XCompose" },
  xinitrc: { color: 9035857, name: "Shell" },
  "xmake.lua": { color: 2269305, name: "Xmake" },
  xsession: { color: 9035857, name: "Shell" },
  "yarn.lock": { color: 13309726, name: "YAML" },
  zlogin: { color: 9035857, name: "Shell" },
  zlogout: { color: 9035857, name: "Shell" },
  zprofile: { color: 9035857, name: "Shell" },
  zshenv: { color: 9035857, name: "Shell" },
  zshrc: { color: 9035857, name: "Shell" }
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
function buildPushPayloads(event, input, config) {
  const enrichment = Array.isArray(input) ? enrichmentFromDetails(input) : input;
  const changes = enrichment.fileGroups;
  const language = detectDominantLanguage([
    ...changes.added,
    ...changes.modified,
    ...changes.renamed,
    ...changes.removed
  ]);
  const latestCommit = event.headCommit || event.commits.at(-1);
  const thumbnailUrl = enrichment.fileDetailsUnavailable ? event.repository.avatarUrl : languageIconUrl(language) || event.repository.avatarUrl;
  const color = embedColor(config, language);
  const notes = eventNotes(event, enrichment);
  const primaryEmbed = {
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
      inlineField("Files", fileCountLabel(enrichment)),
      inlineField("Lines", lineSummary(enrichment.stats)),
      inlineField("Language", languageLabel(language, enrichment)),
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
  };
  if (notes.length > 0) {
    const noteField = {
      inline: false,
      name: "Notes",
      value: notes.join("\n")
    };
    if (canAddField(primaryEmbed, noteField)) {
      primaryEmbed.fields = [...primaryEmbed.fields || [], noteField];
    } else {
      appendFooterNote(primaryEmbed, "Some notes were omitted.");
    }
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
  const payloads = [payload(finalizeEmbed(primaryEmbed), config)];
  for (const field of overflowFields) {
    const embed = finalizeEmbed({
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
  return capPayloads(payloads, config.maxMessages);
}
function buildCompactDependencyPayload(event, config, reason) {
  const latestCommit = event.headCommit || event.commits.at(-1);
  const language = detectDominantLanguage(event.commits.flatMap(commitFileNames));
  const embed = finalizeEmbed({
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
  const embed = finalizeEmbed({
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
    title: config.title || titleForDeletion(event),
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
    username: config.username ? truncate(config.username, DISCORD_LIMITS.username) : void 0
  };
}
function enrichmentFromDetails(details) {
  const fileGroups = aggregateChanges(details);
  const stats = typeof fileGroups.additions === "number" && typeof fileGroups.deletions === "number" && typeof fileGroups.total === "number" ? {
    additions: fileGroups.additions,
    deletions: fileGroups.deletions,
    total: fileGroups.total
  } : void 0;
  return {
    commitDetails: details,
    enrichmentNotes: [],
    fileCount: totalFileCount(fileGroups),
    fileCountCapped: false,
    fileGroups,
    stats
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
function eventNotes(event, enrichment) {
  const notes = [...enrichment.enrichmentNotes];
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
  if (enrichment.fileCountCapped) {
    notes.push("GitHub may cap changed file details for very large comparisons.");
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
function capPayloads(payloads, maxPayloads) {
  if (payloads.length <= maxPayloads) {
    return payloads;
  }
  const capped = payloads.slice(0, maxPayloads);
  const lastEmbed = capped.at(-1)?.embeds[0];
  if (lastEmbed) {
    appendFooterNote(lastEmbed, `Output truncated to ${maxPayloads} messages.`);
    const normalized = finalizeEmbed(lastEmbed);
    const lastPayload = capped.at(-1);
    if (lastPayload) {
      lastPayload.embeds = [normalized];
    }
  }
  return capped;
}
function lineSummary(stats) {
  if (!stats) {
    return "Unavailable";
  }
  return `+${stats.additions} / -${stats.deletions} (${stats.total})`;
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
    return event.refType === "tag" ? "Tag published" : "Branch created";
  }
  return "Push delivered";
}
function titleForDeletion(event) {
  if (event.refType === "tag") {
    return "Tag deleted";
  }
  if (event.refType === "branch") {
    return "Branch deleted";
  }
  return "Ref deleted";
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
function fileCountLabel(enrichment) {
  if (enrichment.fileDetailsUnavailable) {
    return "Unavailable";
  }
  return enrichment.fileCountCapped ? `${enrichment.fileCount}+` : String(enrichment.fileCount);
}
function languageLabel(language, enrichment) {
  return enrichment.fileDetailsUnavailable ? "Unavailable" : language.name;
}
function finalizeEmbed(embed) {
  let result = normalizeEmbedWithMetadata(embed);
  if (result.droppedFields > 0 || result.truncated) {
    const parts = [];
    if (result.droppedFields > 0) {
      parts.push(`${result.droppedFields} field${result.droppedFields === 1 ? "" : "s"} omitted`);
    }
    if (result.truncated) {
      parts.push("text shortened");
    }
    appendFooterNote(result.embed, parts.join("; "));
    result = normalizeEmbedWithMetadata(result.embed);
  }
  return result.embed;
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
    throw new DaisyTrackerError(
      "Missing GITHUB_EVENT_PATH. DaisyTracker must run inside GitHub Actions.",
      { kind: "configuration" }
    );
  }
  try {
    const payload2 = JSON.parse(await (0, import_promises.readFile)(eventPath, "utf8"));
    return normalizePushPayload(payload2, env);
  } catch (error2) {
    throw new DaisyTrackerError("Could not read or parse the GitHub event payload.", {
      cause: error2,
      kind: "configuration"
    });
  }
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
var DEFAULT_CONCURRENCY = 6;
var DEFAULT_TIMEOUT_MS2 = 1e4;
var GITHUB_COMPARE_FILE_LIMIT = 300;
var GITHUB_TOKEN_EXPRESSION = "${{ github.token }}";
async function fetchPushEnrichment(event, options) {
  const visibleCommits = event.commits.slice(-options.maxCommits);
  const payloadDetails = event.commits.map(commitDetailsFromPayload);
  const visiblePayloadDetails = visibleCommits.map(commitDetailsFromPayload);
  const payloadHasFileDetails = hasFileDetails(payloadDetails);
  if (!options.token && payloadHasFileDetails) {
    return enrichmentFromDetails2(visiblePayloadDetails, payloadDetails);
  }
  const fetchImpl = options.fetch || globalThis.fetch;
  const compare = await fetchCompareEnrichment(event, options.token, fetchImpl, options.timeoutMs, {
    warnOnFailure: Boolean(options.token)
  });
  if (compare) {
    return {
      commitDetails: visiblePayloadDetails,
      enrichmentNotes: compare.enrichmentNotes,
      fileCount: compare.fileCount,
      fileCountCapped: compare.fileCountCapped,
      fileGroups: compare.fileGroups,
      stats: compare.stats
    };
  }
  const commitDetails = await fetchCommitDetails(event, {
    ...options,
    forceApi: !options.token && !payloadHasFileDetails
  });
  const enrichment = enrichmentFromDetails2(commitDetails, commitDetails);
  if (!payloadHasFileDetails && !hasFileDetails(commitDetails) && event.commits.length > 0) {
    enrichment.fileDetailsUnavailable = true;
    enrichment.enrichmentNotes.push(
      options.token ? "Changed-file details were unavailable from GitHub API; showing commit summary only." : `Changed-file details need GitHub API credentials for private repositories. Pass github-token: ${GITHUB_TOKEN_EXPRESSION}.`
    );
  }
  if (event.commits.length > commitDetails.length) {
    enrichment.enrichmentNotes.push(
      `File details are limited to the latest ${commitDetails.length} commit${commitDetails.length === 1 ? "" : "s"} because compare enrichment was unavailable.`
    );
  }
  return enrichment;
}
async function fetchCommitDetails(event, options) {
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
        options.timeoutMs || DEFAULT_TIMEOUT_MS2
      );
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      warn(
        `Could not fetch commit details for ${shortSha2(commit.id)}. Using webhook payload data. ${message}`
      );
      return commitDetailsFromPayload(commit);
    }
  });
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
async function fetchCommitDetail(event, commit, token, fetchImpl, timeoutMs) {
  const response = await fetchWithTimeout2(
    fetchImpl,
    `https://api.github.com/repos/${event.repository.fullName}/commits/${commit.id}`,
    {
      headers: {
        ...githubHeaders(token)
      }
    },
    timeoutMs
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
async function fetchCompareEnrichment(event, token, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS2, options = {}) {
  if (!canCompare(event)) {
    return void 0;
  }
  try {
    const response = await fetchWithTimeout2(
      fetchImpl,
      `https://api.github.com/repos/${event.repository.fullName}/compare/${event.before}...${event.after}`,
      {
        headers: {
          ...githubHeaders(token)
        }
      },
      timeoutMs
    );
    if (!response.ok) {
      throw new Error(`GitHub compare API returned ${response.status}.`);
    }
    const data = await response.json();
    const files = data.files || [];
    const fileGroups = groupCommitFiles(files);
    const stats = statsFromFiles(files);
    const fileCountCapped = files.length >= GITHUB_COMPARE_FILE_LIMIT;
    const enrichmentNotes = [];
    if (fileCountCapped) {
      enrichmentNotes.push(
        `GitHub compare file lists may be capped at ${GITHUB_COMPARE_FILE_LIMIT} files.`
      );
    }
    return {
      enrichmentNotes,
      fileCount: totalFileCount2(fileGroups),
      fileCountCapped,
      fileGroups,
      stats
    };
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    if (options.warnOnFailure) {
      warn(`Could not fetch compare details. Falling back to commit details. ${message}`);
    }
    return void 0;
  }
}
function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    ...token ? { Authorization: `Bearer ${token}` } : {},
    "User-Agent": "DaisyCatTs-DaisyTracker",
    "X-GitHub-Api-Version": "2022-11-28"
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
      groups.renamed.push(
        file.previous_filename ? `${file.previous_filename} -> ${file.filename}` : file.filename
      );
    } else {
      groups.modified.push(file.filename);
    }
  }
  return groups;
}
function enrichmentFromDetails2(commitDetails, fileDetails) {
  const fileGroups = aggregateFileGroups(fileDetails);
  const stats = aggregateStats(fileDetails);
  return {
    commitDetails,
    enrichmentNotes: [],
    fileCount: totalFileCount2(fileGroups),
    fileCountCapped: false,
    fileGroups,
    stats
  };
}
function hasFileDetails(details) {
  return details.some(
    (detail) => detail.added.length > 0 || detail.modified.length > 0 || (detail.renamed || []).length > 0 || detail.removed.length > 0
  );
}
function aggregateFileGroups(details) {
  const added = /* @__PURE__ */ new Set();
  const modified = /* @__PURE__ */ new Set();
  const renamed = /* @__PURE__ */ new Set();
  const removed = /* @__PURE__ */ new Set();
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
    removed: [...removed].sort()
  };
}
function aggregateStats(details) {
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
  return hasStats ? { additions, deletions, total } : void 0;
}
function statsFromFiles(files) {
  if (files.length === 0) {
    return void 0;
  }
  let additions = 0;
  let deletions = 0;
  let total = 0;
  let hasStats = false;
  for (const file of files) {
    if (typeof file.additions === "number" || typeof file.deletions === "number" || typeof file.changes === "number") {
      hasStats = true;
      additions += file.additions || 0;
      deletions += file.deletions || 0;
      total += file.changes || (file.additions || 0) + (file.deletions || 0);
    }
  }
  return hasStats ? { additions, deletions, total } : void 0;
}
function totalFileCount2(groups) {
  return groups.added.length + groups.modified.length + groups.renamed.length + groups.removed.length;
}
function canCompare(event) {
  return Boolean(
    event.before && event.after && !isZeroSha(event.before) && !isZeroSha(event.after)
  );
}
function isZeroSha(sha) {
  return /^0+$/.test(sha);
}
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        const item = items[currentIndex];
        if (item !== void 0) {
          results[currentIndex] = await mapper(item);
        }
      }
    })
  );
  return results;
}
async function fetchWithTimeout2(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error2) {
    if (error2 instanceof Error && error2.name === "AbortError") {
      throw new Error(`GitHub API request timed out after ${timeoutMs}ms.`);
    }
    throw error2;
  } finally {
    clearTimeout(timeout);
  }
}
function shortSha2(sha) {
  return sha.slice(0, 7) || "unknown";
}

// src/action.ts
async function run(env = process.env, fetchImpl = globalThis.fetch) {
  let config;
  try {
    config = readActionConfig(env);
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
      throw new DaisyTrackerError(
        "Missing Discord webhook URL. Set the discord-webhook-url input or DISCORD_WEBHOOK_URL.",
        { kind: "configuration" }
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
          redactValues: [config.githubToken],
          threadId: config.threadId
        }
      );
      info("DaisyTracker sent a compact dependency update summary.");
      return;
    }
    if (event.deleted) {
      await sendDiscordPayloads(config.discordWebhookUrl, [buildRefDeletedPayload(event, config)], {
        fetch: fetchImpl,
        redactValues: [config.githubToken],
        threadId: config.threadId
      });
      info("DaisyTracker sent a deleted ref summary.");
      return;
    }
    const enrichment = await fetchPushEnrichment(event, {
      fetch: fetchImpl,
      maxCommits: config.maxCommits,
      token: config.githubToken
    });
    const payloads = buildPushPayloads(event, enrichment, config);
    await sendDiscordPayloads(config.discordWebhookUrl, payloads, {
      fetch: fetchImpl,
      redactValues: [config.githubToken],
      threadId: config.threadId
    });
    info(`DaisyTracker sent ${payloads.length} Discord webhook payload(s).`);
  } catch (error2) {
    const failOnError = config?.failOnError ?? shouldFailOnError(env);
    if (failOnError || !shouldWarnOnly(error2)) {
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
