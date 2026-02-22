import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenClawCodingTools } from "../agents/pi-tools.js";

vi.mock("../agents/tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
}));

describe("Mindfly V1 tool approvals spec (file tools)", () => {
  let previousHome: string | undefined;
  let previousUserProfile: string | undefined;
  let homeDir: string;

  beforeEach(async () => {
    previousHome = process.env.HOME;
    previousUserProfile = process.env.USERPROFILE;
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-approvals-home-"));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(() => {
    vi.resetAllMocks();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  });

  it("defaults to deny when approval yields no decision (timeout)", async () => {
    const { callGatewayTool } = await import("../agents/tools/gateway.js");
    vi.mocked(callGatewayTool).mockResolvedValue({});

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-approvals-ws-"));
    const tools = createOpenClawCodingTools({
      workspaceDir,
      sessionKey: "test:tool-approvals-timeout",
      config: {
        tools: {
          safety: {
            toolApprovals: {
              enabled: true,
              fileMode: "on-new-path",
              browserMode: "off",
            },
          },
        },
      },
    });
    const writeTool = tools.find((tool) => tool.name === "write");
    expect(writeTool).toBeDefined();

    await expect(writeTool?.execute("call", { path: "a.txt", content: "hello" })).rejects.toThrow(
      /approval-timeout/,
    );

    await expect(fs.readFile(path.join(workspaceDir, "a.txt"), "utf8")).rejects.toThrow();
    expect(vi.mocked(callGatewayTool).mock.calls[0]?.[0]).toBe("tool.approval.request");
  });

  it("caches allow-once within a session (ask on first path)", async () => {
    const { callGatewayTool } = await import("../agents/tools/gateway.js");
    const calls: string[] = [];
    vi.mocked(callGatewayTool).mockImplementation(async (method) => {
      calls.push(method);
      if (method === "tool.approval.request") {
        return { decision: "allow-once" };
      }
      return { ok: true };
    });

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-approvals-ws-"));
    const tools = createOpenClawCodingTools({
      workspaceDir,
      sessionKey: "test:tool-approvals-session",
      config: {
        tools: {
          safety: {
            toolApprovals: { enabled: true, browserMode: "off" },
          },
        },
      },
    });
    const writeTool = tools.find((tool) => tool.name === "write");
    expect(writeTool).toBeDefined();

    await writeTool?.execute("call-1", { path: "a.txt", content: "a" });
    await writeTool?.execute("call-2", { path: "b.txt", content: "b" });

    expect(calls.filter((c) => c === "tool.approval.request")).toHaveLength(1);
    expect(await fs.readFile(path.join(workspaceDir, "a.txt"), "utf8")).toBe("a");
    expect(await fs.readFile(path.join(workspaceDir, "b.txt"), "utf8")).toBe("b");
  });

  it("persists allow-always to tool-approvals.json and skips prompting next session", async () => {
    const { callGatewayTool } = await import("../agents/tools/gateway.js");
    vi.mocked(callGatewayTool).mockResolvedValue({ decision: "allow-always" });

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-approvals-ws-"));
    const toolsA = createOpenClawCodingTools({
      workspaceDir,
      sessionKey: "test:tool-approvals-a",
      config: {
        tools: {
          safety: {
            toolApprovals: { enabled: true, browserMode: "off" },
          },
        },
      },
    });
    const writeA = toolsA.find((tool) => tool.name === "write");
    await writeA?.execute("call-a", { path: "a.txt", content: "a" });
    expect(
      vi.mocked(callGatewayTool).mock.calls.some((c) => c[0] === "tool.approval.request"),
    ).toBe(true);

    vi.mocked(callGatewayTool).mockClear();

    const toolsB = createOpenClawCodingTools({
      workspaceDir,
      sessionKey: "test:tool-approvals-b",
      config: {
        tools: {
          safety: {
            toolApprovals: { enabled: true, browserMode: "off" },
          },
        },
      },
    });
    const writeB = toolsB.find((tool) => tool.name === "write");
    await writeB?.execute("call-b", { path: "b.txt", content: "b" });

    expect(
      vi.mocked(callGatewayTool).mock.calls.some((c) => c[0] === "tool.approval.request"),
    ).toBe(false);
    expect(await fs.readFile(path.join(workspaceDir, "b.txt"), "utf8")).toBe("b");

    const approvalsPath = path.join(homeDir, ".openclaw", "tool-approvals.json");
    const saved = await fs.readFile(approvalsPath, "utf8");
    expect(saved).toContain("fs.write");
  });
});
