import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { OpenClawConfig } from "../config/config.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import {
  addToolApprovalEntry,
  findToolApprovalMatch,
  loadToolApprovals,
  recordToolApprovalUse,
  resolveToolApprovalDirGlob,
  saveToolApprovals,
  type ToolApprovalDecision,
  type ToolApprovalToolGroup,
} from "../infra/tool-approvals.js";
import {
  hasSessionToolApproval,
  recordSessionToolApproval,
} from "../infra/tool-approvals-session.js";
import { callGatewayTool } from "./tools/gateway.js";

export type ToolApprovalFileMode = "off" | "on-new-path" | "always";
export type ToolApprovalBrowserMode = "off" | "per-session" | "always";

export type ToolApprovalsPolicy = {
  enabled: boolean;
  timeoutMs: number;
  fileMode: ToolApprovalFileMode;
  browserMode: ToolApprovalBrowserMode;
};

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;

function resolveToolApprovalsPolicyFromConfig(cfg?: OpenClawConfig): ToolApprovalsPolicy {
  const toolApprovals = cfg?.tools?.safety?.toolApprovals;
  const enabled = toolApprovals?.enabled === true;
  const timeoutMsRaw = toolApprovals?.timeoutMs;
  const timeoutMs =
    typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
      ? Math.max(1, Math.floor(timeoutMsRaw))
      : DEFAULT_APPROVAL_TIMEOUT_MS;
  const fileMode =
    toolApprovals?.fileMode === "always" || toolApprovals?.fileMode === "off"
      ? toolApprovals.fileMode
      : toolApprovals?.fileMode === "on-new-path"
        ? "on-new-path"
        : enabled
          ? "on-new-path"
          : "off";
  const browserMode =
    toolApprovals?.browserMode === "always" || toolApprovals?.browserMode === "off"
      ? toolApprovals.browserMode
      : toolApprovals?.browserMode === "per-session"
        ? "per-session"
        : enabled
          ? "per-session"
          : "off";
  return {
    enabled,
    timeoutMs,
    fileMode,
    browserMode,
  };
}

export function isToolApprovalsEnabled(cfg?: OpenClawConfig): boolean {
  return resolveToolApprovalsPolicyFromConfig(cfg).enabled;
}

export function resolveToolApprovalsPolicy(cfg?: OpenClawConfig): ToolApprovalsPolicy {
  return resolveToolApprovalsPolicyFromConfig(cfg);
}

function normalizeUnicodeSpaces(str: string): string {
  return str.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
}

function expandHome(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(filePath);
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/")) {
    return os.homedir() + normalized.slice(1);
  }
  return normalized;
}

function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandHome(filePath);
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.resolve(cwd, expanded);
}

function tryRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function canonicalizeFilePathForApproval(filePath: string, cwd: string): string {
  const resolved = resolveToCwd(filePath, cwd);
  const real = tryRealpath(resolved);
  if (real) {
    return real;
  }
  const parent = path.dirname(resolved);
  const parentReal = parent ? tryRealpath(parent) : null;
  if (parentReal) {
    return path.join(parentReal, path.basename(resolved));
  }
  return resolved;
}

function resolveRootGlob(root: string): string {
  const resolved = canonicalizeFilePathForApproval(root, process.cwd());
  const suffix = resolved.endsWith(path.sep) ? "**" : `${path.sep}**`;
  return `${resolved}${suffix}`;
}

function isApprovalDecision(value: unknown): value is ToolApprovalDecision {
  return value === "allow-once" || value === "allow-always" || value === "deny";
}

async function requestToolApproval(params: {
  toolName: string;
  toolGroup: ToolApprovalToolGroup;
  summary: string;
  cwd?: string;
  agentId?: string;
  sessionKey?: string;
  target?: string;
  targets?: string[];
  allowAlways?: boolean;
  timeoutMs: number;
}): Promise<{ id: string; decision: ToolApprovalDecision | null }> {
  const approvalId = crypto.randomUUID();
  const decisionResult = await callGatewayTool<{ decision?: unknown }>(
    "tool.approval.request",
    { timeoutMs: params.timeoutMs + 10_000 },
    {
      id: approvalId,
      toolName: params.toolName,
      toolGroup: params.toolGroup,
      summary: params.summary,
      cwd: params.cwd,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      ...(params.target ? { target: params.target } : {}),
      ...(params.targets && params.targets.length ? { targets: params.targets } : {}),
      ...(typeof params.allowAlways === "boolean" ? { allowAlways: params.allowAlways } : {}),
      timeoutMs: params.timeoutMs,
    },
  );
  const decisionValue =
    decisionResult && typeof decisionResult === "object"
      ? (decisionResult as { decision?: unknown }).decision
      : undefined;
  return { id: approvalId, decision: isApprovalDecision(decisionValue) ? decisionValue : null };
}

export async function ensureFileToolApproval(params: {
  config?: OpenClawConfig;
  toolName: string;
  toolGroup: Extract<ToolApprovalToolGroup, "fs.read" | "fs.write">;
  /** Base cwd/root used by the underlying tool when resolving relative paths. */
  cwd: string;
  /** Sandbox root, if the tool is sandboxed (used to broaden approvals). */
  sandboxRoot?: string;
  sessionKey?: string | null;
  agentId?: string | null;
  paths: string[];
  summary: string;
}): Promise<void> {
  const policy = resolveToolApprovalsPolicyFromConfig(params.config);
  if (!policy.enabled || policy.fileMode === "off") {
    return;
  }

  const cwd = params.cwd || process.cwd();
  const rawPaths = params.paths.filter((p) => typeof p === "string" && p.trim());
  const canonicalPaths = Array.from(
    new Set(rawPaths.map((p) => canonicalizeFilePathForApproval(p, cwd))),
  );
  if (canonicalPaths.length === 0) {
    return;
  }

  const needsApproval: string[] = [];
  const matchedEntryIds = new Set<string>();
  const toolApprovalsFile = policy.fileMode === "always" ? null : loadToolApprovals();

  for (const target of canonicalPaths) {
    if (policy.fileMode === "always") {
      needsApproval.push(target);
      continue;
    }
    if (
      hasSessionToolApproval({
        sessionKey: params.sessionKey,
        toolGroup: params.toolGroup,
        target,
      })
    ) {
      continue;
    }
    const match = toolApprovalsFile
      ? findToolApprovalMatch({ file: toolApprovalsFile, toolGroup: params.toolGroup, target })
      : null;
    if (!match) {
      needsApproval.push(target);
      continue;
    }
    matchedEntryIds.add(match.id);
  }

  if (matchedEntryIds.size > 0 && toolApprovalsFile) {
    try {
      let nextFile = toolApprovalsFile;
      for (const entryId of matchedEntryIds) {
        nextFile = recordToolApprovalUse({ file: nextFile, entryId, lastExample: params.summary });
      }
      saveToolApprovals(nextFile);
    } catch {
      // best-effort
    }
  }

  if (needsApproval.length === 0) {
    return;
  }

  let approvalId: string | null = null;
  let decision: ToolApprovalDecision | null = null;
  try {
    const approval = await requestToolApproval({
      toolName: params.toolName,
      toolGroup: params.toolGroup,
      summary: params.summary,
      cwd,
      agentId: params.agentId ?? undefined,
      sessionKey: params.sessionKey ?? undefined,
      targets: needsApproval.length > 1 ? needsApproval : undefined,
      target: needsApproval.length === 1 ? needsApproval[0] : undefined,
      allowAlways: true,
      timeoutMs: policy.timeoutMs,
    });
    approvalId = approval.id;
    decision = approval.decision;
  } catch (err) {
    if (params.sessionKey) {
      enqueueSystemEvent(
        `Tool denied (id=${approvalId ?? "unknown"}, approval-request-failed): ${params.summary}`,
        { sessionKey: params.sessionKey, contextKey: `tool:${params.toolName}` },
      );
    }
    throw err;
  }

  if (decision === "deny") {
    if (params.sessionKey) {
      enqueueSystemEvent(
        `Tool denied (id=${approvalId ?? "unknown"}, user-denied): ${params.summary}`,
        {
          sessionKey: params.sessionKey,
          contextKey: `tool:${params.toolName}`,
        },
      );
    }
    throw new Error(`Tool denied: ${params.toolName}`);
  }

  if (!decision) {
    if (params.sessionKey) {
      enqueueSystemEvent(
        `Tool denied (id=${approvalId ?? "unknown"}, approval-timeout): ${params.summary}`,
        {
          sessionKey: params.sessionKey,
          contextKey: `tool:${params.toolName}`,
        },
      );
    }
    throw new Error(`Tool denied (approval-timeout): ${params.toolName}`);
  }

  const patterns =
    params.sandboxRoot && params.sandboxRoot.trim()
      ? [resolveRootGlob(params.sandboxRoot)]
      : needsApproval.map((target) => resolveToolApprovalDirGlob(target));
  const uniquePatterns = Array.from(new Set(patterns.filter((p) => p.trim())));

  for (const pattern of uniquePatterns) {
    recordSessionToolApproval({
      sessionKey: params.sessionKey,
      toolGroup: params.toolGroup,
      target: pattern,
    });
  }

  if (decision === "allow-always") {
    try {
      let file = loadToolApprovals();
      for (const pattern of uniquePatterns) {
        file = addToolApprovalEntry({
          file,
          toolGroup: params.toolGroup,
          pattern,
          lastExample: params.summary,
        });
      }
      saveToolApprovals(file);
    } catch {
      // best-effort
    }
  }
}

export async function ensureBrowserToolApproval(params: {
  config?: OpenClawConfig;
  toolGroup: Extract<ToolApprovalToolGroup, "browser.read" | "browser.control">;
  summary: string;
  cwd?: string;
  sessionKey?: string | null;
  agentId?: string | null;
  /**
   * When true, do not cache allow-once decisions in the session (always prompt).
   * Intended for high-risk actions like browser.evaluate.
   */
  alwaysAsk?: boolean;
}): Promise<void> {
  const policy = resolveToolApprovalsPolicyFromConfig(params.config);
  if (!policy.enabled || policy.browserMode === "off") {
    return;
  }

  const mode = policy.browserMode;
  const alwaysAsk = params.alwaysAsk === true || mode === "always";
  if (!alwaysAsk) {
    const approved = hasSessionToolApproval({
      sessionKey: params.sessionKey,
      toolGroup: params.toolGroup,
    });
    if (approved) {
      return;
    }
  }

  let approvalId: string | null = null;
  let decision: ToolApprovalDecision | null = null;
  try {
    const approval = await requestToolApproval({
      toolName: "browser",
      toolGroup: params.toolGroup,
      summary: params.summary,
      cwd: params.cwd,
      agentId: params.agentId ?? undefined,
      sessionKey: params.sessionKey ?? undefined,
      allowAlways: false,
      timeoutMs: policy.timeoutMs,
    });
    approvalId = approval.id;
    decision = approval.decision;
  } catch (err) {
    if (params.sessionKey) {
      enqueueSystemEvent(
        `Tool denied (id=${approvalId ?? "unknown"}, approval-request-failed): ${params.summary}`,
        {
          sessionKey: params.sessionKey,
          contextKey: `tool:browser`,
        },
      );
    }
    throw err;
  }

  if (decision === "deny") {
    if (params.sessionKey) {
      enqueueSystemEvent(
        `Tool denied (id=${approvalId ?? "unknown"}, user-denied): ${params.summary}`,
        {
          sessionKey: params.sessionKey,
          contextKey: `tool:browser`,
        },
      );
    }
    throw new Error("Tool denied: browser");
  }
  if (!decision) {
    if (params.sessionKey) {
      enqueueSystemEvent(
        `Tool denied (id=${approvalId ?? "unknown"}, approval-timeout): ${params.summary}`,
        {
          sessionKey: params.sessionKey,
          contextKey: `tool:browser`,
        },
      );
    }
    throw new Error("Tool denied (approval-timeout): browser");
  }

  if (!alwaysAsk) {
    recordSessionToolApproval({
      sessionKey: params.sessionKey,
      toolGroup: params.toolGroup,
    });
  }
}
