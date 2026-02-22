import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebSearchTool } from "./web-search.js";

type MockResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function requestUrl(input: RequestInfo): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if ("url" in input && typeof input.url === "string") {
    return input.url;
  }
  return "";
}

describe("web_search external content wrapping", () => {
  const priorFetch = global.fetch;

  afterEach(() => {
    // @ts-expect-error restore
    global.fetch = priorFetch;
    vi.restoreAllMocks();
  });

  it("wraps Brave snippets in untrusted boundaries by default", async () => {
    const mockFetch = vi.fn((input: RequestInfo) => {
      const url = requestUrl(input);
      if (!url.includes("api.search.brave.com")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [
              {
                title: "Example",
                url: "https://example.com",
                description: "snippet text",
              },
            ],
          },
        }),
      } satisfies MockResponse as unknown as Response);
    });
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({
      config: {
        tools: {
          web: {
            search: {
              enabled: true,
              provider: "brave",
              apiKey: "brave-test",
              cacheTtlMinutes: 0,
            },
          },
        },
      },
      sandboxed: false,
    });

    const result = await tool?.execute?.("call", { query: "test", count: 1 });
    const contentText = (result?.content?.[0] as { text?: string } | undefined)?.text ?? "";
    const contentPayload = JSON.parse(contentText) as {
      results?: Array<{ description?: string }>;
    };

    expect(contentPayload.results?.[0]?.description).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(contentPayload.results?.[0]?.description).toContain(
      "<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>",
    );

    const details = result?.details as { results?: Array<{ description?: string }> };
    expect(details.results?.[0]?.description).toBe("snippet text");
  });
});
