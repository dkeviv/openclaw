import { describe, expect, it, vi } from "vitest";

import { ToolApprovalManager } from "../tool-approval-manager.js";
import { createToolApprovalHandlers } from "./tool-approval.js";
import { validateToolApprovalRequestParams } from "../protocol/index.js";

const noop = () => {};

describe("tool approval handlers", () => {
  describe("ToolApprovalRequestParams validation", () => {
    it("accepts a minimal request", () => {
      const params = {
        toolName: "write",
        toolGroup: "fs.write",
        summary: "Write file",
      };
      expect(validateToolApprovalRequestParams(params)).toBe(true);
    });
  });

  it("broadcasts request + resolve", async () => {
    const manager = new ToolApprovalManager();
    const handlers = createToolApprovalHandlers(manager);
    const broadcasts: Array<{ event: string; payload: unknown }> = [];

    const respond = vi.fn();
    const context = {
      broadcast: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
    };

    const requestPromise = handlers["tool.approval.request"]({
      params: {
        toolName: "write",
        toolGroup: "fs.write",
        summary: "Write file hello.txt",
        cwd: "/tmp",
        timeoutMs: 2000,
        allowAlways: true,
        target: "/tmp/hello.txt",
      },
      respond,
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.request"]
      >[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "tool.approval.request" },
      isWebchatConnect: noop,
    });

    const requested = broadcasts.find((entry) => entry.event === "tool.approval.requested");
    expect(requested).toBeTruthy();
    const id = (requested?.payload as { id?: string })?.id ?? "";
    expect(id).not.toBe("");

    const resolveRespond = vi.fn();
    await handlers["tool.approval.resolve"]({
      params: { id, decision: "allow-once" },
      respond: resolveRespond,
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.resolve"]
      >[0]["context"],
      client: { connect: { client: { id: "cli", displayName: "CLI" } } },
      req: { id: "req-2", type: "req", method: "tool.approval.resolve" },
      isWebchatConnect: noop,
    });

    await requestPromise;

    expect(resolveRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ id, decision: "allow-once" }),
      undefined,
    );
    expect(broadcasts.some((entry) => entry.event === "tool.approval.resolved")).toBe(true);
  });

  it("accepts explicit approval ids", async () => {
    const manager = new ToolApprovalManager();
    const handlers = createToolApprovalHandlers(manager);
    const broadcasts: Array<{ event: string; payload: unknown }> = [];

    const respond = vi.fn();
    const context = {
      broadcast: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
    };

    const requestPromise = handlers["tool.approval.request"]({
      params: {
        id: "approval-123",
        toolName: "read",
        toolGroup: "fs.read",
        summary: "Read file",
        timeoutMs: 2000,
        target: "/tmp/readme.txt",
      },
      respond,
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.request"]
      >[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "tool.approval.request" },
      isWebchatConnect: noop,
    });

    const requested = broadcasts.find((entry) => entry.event === "tool.approval.requested");
    const id = (requested?.payload as { id?: string })?.id ?? "";
    expect(id).toBe("approval-123");

    await handlers["tool.approval.resolve"]({
      params: { id, decision: "deny" },
      respond: vi.fn(),
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.resolve"]
      >[0]["context"],
      client: { connect: { client: { id: "cli", displayName: "CLI" } } },
      req: { id: "req-2", type: "req", method: "tool.approval.resolve" },
      isWebchatConnect: noop,
    });

    await requestPromise;
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ id: "approval-123", decision: "deny" }),
      undefined,
    );
  });

  it("rejects duplicate approval ids", async () => {
    const manager = new ToolApprovalManager();
    const handlers = createToolApprovalHandlers(manager);
    const context = { broadcast: () => {} };

    const respondA = vi.fn();
    const respondB = vi.fn();

    const requestA = handlers["tool.approval.request"]({
      params: {
        id: "approval-dup",
        toolName: "read",
        toolGroup: "fs.read",
        summary: "Read file",
        timeoutMs: 2000,
        target: "/tmp/a.txt",
      },
      respond: respondA,
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.request"]
      >[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "tool.approval.request" },
      isWebchatConnect: noop,
    });

    await handlers["tool.approval.request"]({
      params: {
        id: "approval-dup",
        toolName: "read",
        toolGroup: "fs.read",
        summary: "Read file",
        timeoutMs: 2000,
        target: "/tmp/b.txt",
      },
      respond: respondB,
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.request"]
      >[0]["context"],
      client: null,
      req: { id: "req-2", type: "req", method: "tool.approval.request" },
      isWebchatConnect: noop,
    });

    expect(respondB).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "approval id already pending" }),
    );

    await handlers["tool.approval.resolve"]({
      params: { id: "approval-dup", decision: "allow-once" },
      respond: vi.fn(),
      context: context as unknown as Parameters<
        (typeof handlers)["tool.approval.resolve"]
      >[0]["context"],
      client: { connect: { client: { id: "cli" } } },
      req: { id: "req-3", type: "req", method: "tool.approval.resolve" },
      isWebchatConnect: noop,
    });

    await requestA;
  });
});
