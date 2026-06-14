import { describe, expect, test } from "bun:test";

describe("local preview CLI", () => {
  test("outputs valid Discord payload JSON", async () => {
    const proc = Bun.spawn(["bun", "run", "preview", "tests/fixtures/push.single.json"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("bun src/cli.ts");

    const payloads = JSON.parse(stdout);
    expect(Array.isArray(payloads)).toBe(true);
    expect(payloads[0].allowed_mentions).toEqual({ parse: [] });
    expect(payloads[0].embeds[0].title).toBe("Push delivered");
  });
});
