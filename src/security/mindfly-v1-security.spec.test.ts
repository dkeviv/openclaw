import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnyAgentTool } from "../agents/pi-tools.types.js";
import { createOpenClawReadTool } from "../agents/pi-tools.read.js";
import { authorizeGatewayConnect } from "../gateway/auth.js";

describe("Mindfly V1 security spec", () => {
  const previousEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(previousEnv)) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (const key of Object.keys(previousEnv)) {
      delete previousEnv[key];
    }
  });

  it("scrubs inherited gateway auth env vars from exec subprocess env by default", async () => {
    previousEnv.OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
    previousEnv.CLAWDBOT_GATEWAY_PASSWORD = process.env.CLAWDBOT_GATEWAY_PASSWORD;
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret-token";
    process.env.CLAWDBOT_GATEWAY_PASSWORD = "secret-password";

    const { createExecTool } = await import("../agents/bash-tools.exec.js");
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      approvalRunningNoticeMs: 0,
    });

    const command = `node -e "process.stdout.write(process.env.OPENCLAW_GATEWAY_TOKEN ? 'LEAKED' : 'MISSING')"`;
    const result = await tool.execute("call", {
      command,
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.details.status).toBe("completed");

    const aggregated = (result.details as { aggregated?: string }).aggregated ?? "";
    expect(aggregated).toContain("MISSING");
    expect(aggregated).not.toContain("secret-token");
  });

  it("requires a valid bearer token to authorize gateway connections", async () => {
    const auth = { mode: "token", token: "secret-token", allowTailscale: false } as const;

    await expect(authorizeGatewayConnect({ auth, connectAuth: null })).resolves.toMatchObject({
      ok: false,
      reason: "token_missing",
    });
    await expect(
      authorizeGatewayConnect({ auth, connectAuth: { token: "wrong-token" } }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "token_mismatch",
    });
    await expect(
      authorizeGatewayConnect({ auth, connectAuth: { token: "secret-token" } }),
    ).resolves.toMatchObject({
      ok: true,
      method: "token",
    });
  });

  it("wraps read tool text output in untrusted boundaries by default", async () => {
    const baseTool: AnyAgentTool = {
      name: "read",
      label: "Read",
      description: "stub",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      },
      execute: async () => ({
        content: [{ type: "text", text: "Hello from file" }],
        details: {},
      }),
    };

    const tool = createOpenClawReadTool(baseTool);

    const result = await tool.execute("call", { path: "notes.txt" });
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";

    expect(text).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(text).toContain("<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>");
  });
});
