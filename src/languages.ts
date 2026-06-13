import type { LanguageInfo } from "./types";
import { LANGUAGE_BY_EXTENSION, LANGUAGE_BY_FILENAME } from "./language-data";

export const UNKNOWN_LANGUAGE: LanguageInfo = {
  color: 0x5865f2,
  name: "Mixed",
};

export function detectDominantLanguage(files: string[]): LanguageInfo {
  const counts = new Map<string, { count: number; language: LanguageInfo }>();

  for (const file of files) {
    const language = detectLanguage(file);
    if (!language) {
      continue;
    }

    const existing = counts.get(language.name);
    counts.set(language.name, {
      count: (existing?.count || 0) + 1,
      language,
    });
  }

  return (
    [...counts.values()].sort((left, right) => right.count - left.count)[0]?.language ||
    UNKNOWN_LANGUAGE
  );
}

export function detectLanguage(file: string): LanguageInfo | undefined {
  const normalized = basename(file).toLowerCase();
  const fileMatch = LANGUAGE_BY_FILENAME[normalized];
  if (fileMatch) {
    return fileMatch;
  }

  const extension = normalized.includes(".") ? normalized.split(".").pop() || "" : "";
  return LANGUAGE_BY_EXTENSION[extension];
}

export function languageIconUrl(language: LanguageInfo): string | undefined {
  if (!language.icon) {
    return undefined;
  }

  return `https://raw.githubusercontent.com/DaisyCatTs/Gitracker/master/assets/languages/${language.icon}.png`;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() || file;
}
