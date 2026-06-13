import { describe, expect, test } from "bun:test";
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
  });

  test("chooses the most common changed language", () => {
    const language = detectDominantLanguage(["a.ts", "b.tsx", "script.py", "README.md"]);

    expect(language.name).toBe("TypeScript");
    expect(languageIconUrl(language)).toContain("typescript.png");
  });
});
