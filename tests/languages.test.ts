import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { LANGUAGE_BY_EXTENSION, LANGUAGE_BY_FILENAME } from "../src/language-data";
import { detectDominantLanguage, detectLanguage, languageIconUrl } from "../src/languages";

describe("language detection", () => {
  test("detects broad file extensions and common manifests", () => {
    expect(detectLanguage("src/index.ts")?.name).toBe("TypeScript");
    expect(detectLanguage("main.py")?.name).toBe("Python");
    expect(detectLanguage("Cargo.toml")?.name).toBe("Rust");
    expect(detectLanguage("go.mod")?.name).toBe("Go");
    expect(detectLanguage("Program.cs")?.name).toBe("C#");
    expect(detectLanguage("include/app.hpp")?.name).toBe("C++");
    expect(detectLanguage("README.md")?.name).toBe("Markdown");
    expect(detectLanguage("Dockerfile")?.name).toBe("Dockerfile");
    expect(detectLanguage("app/App.svelte")?.name).toBe("Svelte");
    expect(detectLanguage("terraform/main.tf")?.name).toBe("Terraform");
    expect(detectLanguage("mix.exs")?.name).toBe("Elixir");
    expect(detectLanguage("flake.nix")?.name).toBe("Nix");
    expect(detectLanguage(".github/workflows/ci.yml")?.name).toBe("YAML");
    expect(detectLanguage("package.json")?.name).toBe("JavaScript");
    expect(detectLanguage("src/App.tsx")?.name).toBe("TypeScript");
    expect(detectLanguage("src/data.json")?.name).toBe("JSON");
  });

  test("chooses the most common changed language", () => {
    const language = detectDominantLanguage(["a.ts", "b.tsx", "script.py", "README.md"]);

    expect(language.name).toBe("TypeScript");
    expect(languageIconUrl(language)).toContain("typescript.png");
  });

  test("keeps curated language icon references in sync with PNG assets", async () => {
    const assetNames = (await readdir(join(import.meta.dir, "..", "assets", "languages")))
      .filter((name) => name.endsWith(".png"))
      .map((name) => name.replace(/\.png$/, ""))
      .sort();
    const iconNames = [
      ...Object.values(LANGUAGE_BY_EXTENSION),
      ...Object.values(LANGUAGE_BY_FILENAME),
    ]
      .map((language) => language.icon)
      .filter((icon): icon is string => Boolean(icon));
    const referencedIcons = [...new Set(iconNames)].sort();

    expect(referencedIcons).toEqual(assetNames);
  });

  test("uses color fallback without broken icons for unsupported icon assets", () => {
    const language = detectLanguage("infra/main.tf");

    expect(language?.name).toBe("Terraform");
    expect(language?.color).toBe(0x844fba);
    expect(language ? languageIconUrl(language) : undefined).toBeUndefined();
  });
});
