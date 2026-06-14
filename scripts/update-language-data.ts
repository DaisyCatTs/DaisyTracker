import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface LinguistLanguage {
  color?: number;
  extensions: string[];
  filenames: string[];
  group?: string;
  name: string;
}

interface GeneratedLanguage {
  color: number;
  icon?: string;
  name: string;
}

const DEFAULT_COLOR = 0x5865f2;
const ROOT = join(import.meta.dir, "..");
const LINGUIST_DATA_PATH = join(ROOT, "vendor", "github-linguist", "languages.yml");
const ASSET_DIR = join(ROOT, "assets", "languages");
const OUTPUT_PATH = join(ROOT, "src", "language-data.ts");

const ICON_BY_LANGUAGE: Record<string, string> = {
  "C#": "csharp",
  "C++": "cpp",
  CSS: "css",
  Go: "go",
  HTML: "html",
  Java: "java",
  JavaScript: "javascript",
  Kotlin: "kotlin",
  Lua: "lua",
  Markdown: "markdown",
  PHP: "php",
  Python: "python",
  Ruby: "ruby",
  Rust: "rust",
  Swift: "swift",
  TypeScript: "typescript",
};

const EXTENSION_OVERRIDES: Record<string, GeneratedLanguage> = {
  cs: { color: 0x178600, icon: "csharp", name: "C#" },
  cts: { color: 0x3178c6, icon: "typescript", name: "TypeScript" },
  fs: { color: 0xb845fc, name: "F#" },
  h: { color: 0xa8b9cc, name: "C/C++ Header" },
  json: { color: 0x292929, name: "JSON" },
  json5: { color: 0x267cb9, name: "JSON5" },
  jsonc: { color: 0x292929, name: "JSON" },
  m: { color: 0x438eff, name: "Objective-C" },
  mts: { color: 0x3178c6, icon: "typescript", name: "TypeScript" },
  pl: { color: 0x0298c3, name: "Perl" },
  r: { color: 0x198ce7, name: "R" },
  tf: { color: 0x844fba, name: "Terraform" },
  tftpl: { color: 0x844fba, name: "Terraform" },
  tfvars: { color: 0x844fba, name: "Terraform" },
  ts: { color: 0x3178c6, icon: "typescript", name: "TypeScript" },
  tsx: { color: 0x3178c6, icon: "typescript", name: "TypeScript" },
  yaml: { color: 0xcb171e, name: "YAML" },
  yml: { color: 0xcb171e, name: "YAML" },
};

const FILENAME_OVERRIDES: Record<string, GeneratedLanguage> = {
  "bun.lock": { color: 0xf9f1e1, name: "Bun" },
  "cargo.lock": { color: 0xdea584, icon: "rust", name: "Rust" },
  "cargo.toml": { color: 0xdea584, icon: "rust", name: "Rust" },
  "composer.json": { color: 0x4f5d95, icon: "php", name: "PHP" },
  "go.mod": { color: 0x00add8, icon: "go", name: "Go" },
  "go.sum": { color: 0x00add8, icon: "go", name: "Go" },
  "package-lock.json": { color: 0xf1e05a, icon: "javascript", name: "JavaScript" },
  "package.json": { color: 0xf1e05a, icon: "javascript", name: "JavaScript" },
  "pom.xml": { color: 0xb07219, icon: "java", name: "Java" },
  "pyproject.toml": { color: 0x3572a5, icon: "python", name: "Python" },
  "requirements.txt": { color: 0x3572a5, icon: "python", name: "Python" },
  "tsconfig.json": { color: 0x3178c6, icon: "typescript", name: "TypeScript" },
};

const checkOnly = process.argv.includes("--check");
const languages = parseLinguistLanguages(await readFile(LINGUIST_DATA_PATH, "utf8"));
const iconNames = await existingIconNames();
const source = generateSource(languages, iconNames);

if (checkOnly) {
  const current = await readFile(OUTPUT_PATH, "utf8");
  if (current !== source) {
    console.error("src/language-data.ts is out of date. Run bun run languages:generate.");
    process.exit(1);
  }
} else {
  await writeFile(OUTPUT_PATH, source, "utf8");
}

function parseLinguistLanguages(source: string): LinguistLanguage[] {
  const languages: LinguistLanguage[] = [];
  let current: LinguistLanguage | undefined;
  let activeList: "extensions" | "filenames" | undefined;

  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#") || line.trim() === "---") {
      continue;
    }

    const languageMatch = line.match(/^([^ ].*):$/);
    if (languageMatch?.[1]) {
      current = {
        extensions: [],
        filenames: [],
        name: unquote(languageMatch[1]),
      };
      languages.push(current);
      activeList = undefined;
      continue;
    }

    if (!current) {
      continue;
    }

    const propertyMatch = line.match(/^ {2}([a-z_]+):\s*(.*)$/);
    if (propertyMatch?.[1]) {
      const property = propertyMatch[1];
      const rawValue = propertyMatch[2] || "";
      activeList = property === "extensions" || property === "filenames" ? property : undefined;

      if (property === "color") {
        current.color = parseColor(unquote(rawValue));
      } else if (property === "group") {
        current.group = unquote(rawValue);
      }
      continue;
    }

    const listMatch = line.match(/^ {2}-\s*(.+)$/);
    if (listMatch?.[1] && activeList) {
      current[activeList].push(unquote(listMatch[1]));
    }
  }

  return languages;
}

async function existingIconNames(): Promise<Set<string>> {
  const files = await readdir(ASSET_DIR);
  return new Set(
    files.filter((file) => file.endsWith(".png")).map((file) => file.replace(/\.png$/, "")),
  );
}

function generateSource(languages: LinguistLanguage[], iconNames: Set<string>): string {
  const colorByName = new Map<string, number>();
  for (const language of languages) {
    colorByName.set(language.name, language.color || DEFAULT_COLOR);
  }

  const byExtension: Record<string, GeneratedLanguage> = {};
  const byFilename: Record<string, GeneratedLanguage> = {};

  for (const language of languages) {
    const info = toLanguageInfo(language, colorByName, iconNames);

    for (const extension of language.extensions) {
      const key = normalizeExtension(extension);
      if (key) {
        byExtension[key] = info;
      }
    }

    for (const filename of language.filenames) {
      const key = normalizeFilename(filename);
      if (key) {
        byFilename[key] = info;
      }
    }
  }

  Object.assign(byExtension, EXTENSION_OVERRIDES);
  Object.assign(byFilename, FILENAME_OVERRIDES);

  return [
    'import type { LanguageInfo } from "./types";',
    "",
    "// Generated from vendor/github-linguist/languages.yml by scripts/update-language-data.ts.",
    "export const LANGUAGE_BY_EXTENSION: Record<string, LanguageInfo> = {",
    serializeMap(byExtension),
    "};",
    "",
    "export const LANGUAGE_BY_FILENAME: Record<string, LanguageInfo> = {",
    serializeMap(byFilename),
    "};",
    "",
  ].join("\n");
}

function toLanguageInfo(
  language: LinguistLanguage,
  colorByName: Map<string, number>,
  iconNames: Set<string>,
): GeneratedLanguage {
  const name = language.group || language.name;
  const icon = ICON_BY_LANGUAGE[name];
  const info: GeneratedLanguage = {
    color: colorByName.get(name) || language.color || DEFAULT_COLOR,
    name,
  };

  if (icon && iconNames.has(icon)) {
    info.icon = icon;
  }

  return info;
}

function serializeMap(map: Record<string, GeneratedLanguage>): string {
  return Object.entries(map)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `  ${serializeKey(key)}: ${serializeLanguageInfo(value)},`)
    .join("\n");
}

function serializeKey(key: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
}

function serializeLanguageInfo(info: GeneratedLanguage): string {
  const parts = [`color: 0x${info.color.toString(16).padStart(6, "0")}`];
  if (info.icon) {
    parts.push(`icon: ${JSON.stringify(info.icon)}`);
  }
  parts.push(`name: ${JSON.stringify(info.name)}`);
  return `{ ${parts.join(", ")} }`;
}

function normalizeExtension(extension: string): string {
  const value = extension.toLowerCase();
  if (!value.startsWith(".") || value.includes("*")) {
    return "";
  }

  return value.slice(1);
}

function normalizeFilename(filename: string): string {
  const value = filename.toLowerCase();
  return value.includes("*") ? "" : value;
}

function parseColor(value: string): number | undefined {
  return /^#[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.slice(1), 16) : undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
