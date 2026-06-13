import { describe, expect, test } from "bun:test";
import { sendDiscordPayloads } from "../src/discord";

const payload = {
  embeds: [{ description: "hello", title: "DaisyTracker" }],
};

describe("Discord webhook sender", () => {
  test("adds wait=true to webhook requests", async () => {
    const urls: string[] = [];
    const fetchMock = async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("", { status: 204 });
    };

    await sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(urls[0]).toContain("wait=true");
  });

  test("appends thread-id to webhook requests", async () => {
    const urls: string[] = [];
    const fetchMock = async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("", { status: 204 });
    };

    await sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
      fetch: fetchMock as unknown as typeof fetch,
      threadId: "987654321",
    });

    expect(urls[0]).toContain("thread_id=987654321");
  });

  test("retries rate-limited webhook requests", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ retry_after: 0 }), { status: 429 });
      }

      return new Response("", { status: 204 });
    };

    await sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    expect(calls).toBe(2);
  });

  test("uses retry-after headers for rate limits", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", {
          headers: { "retry-after": "0.25" },
          status: 429,
        });
      }

      return new Response("", { status: 204 });
    };

    await sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    expect(delays).toEqual([250]);
  });

  test("retries server errors", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return new Response("", { status: calls === 1 ? 502 : 204 });
    };

    await sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    expect(calls).toBe(2);
  });

  test("does not retry bad requests", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return new Response("bad payload", { status: 400 });
    };

    await expect(
      sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("400");
    expect(calls).toBe(1);
  });

  test("does not retry missing or unauthorized webhooks", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    };

    await expect(
      sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("404");
    expect(calls).toBe(1);
  });

  test("redacts webhook tokens in errors", async () => {
    const fetchMock = async () => new Response("bad payload", { status: 400 });

    await expect(
      sendDiscordPayloads("https://discord.com/api/webhooks/123/secret-token", [payload], {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("webhooks/123/***");
  });

  test("rejects non-https webhook URLs", async () => {
    await expect(
      sendDiscordPayloads("http://discord.com/api/webhooks/123/token", [payload]),
    ).rejects.toThrow("https");
  });

  test("rejects invalid payloads before sending", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return new Response("", { status: 204 });
    };

    await expect(
      sendDiscordPayloads(
        "https://discord.com/api/webhooks/123/token",
        [{ embeds: [{ title: "x".repeat(300) }] }],
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow("title");
    expect(calls).toBe(0);
  });
});
