import type { ToolApprovalToolGroup } from "./tool-approvals.js";
import { matchesToolApprovalPattern } from "./tool-approvals.js";

type FileToolGroup = Extract<ToolApprovalToolGroup, "fs.read" | "fs.write">;
type BrowserToolGroup = Extract<ToolApprovalToolGroup, "browser.read" | "browser.control">;

type SessionToolApprovals = {
  updatedAtMs: number;
  files: Record<FileToolGroup, Set<string>>;
  browser: Record<BrowserToolGroup, boolean>;
};

const MAX_SESSIONS = 500;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const sessions = new Map<string, SessionToolApprovals>();

function pruneSessions() {
  if (sessions.size === 0) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (now - entry.updatedAtMs > MAX_AGE_MS) {
      sessions.delete(key);
    }
  }
  if (sessions.size <= MAX_SESSIONS) {
    return;
  }
  const ordered = Array.from(sessions.entries()).toSorted(
    (a, b) => a[1].updatedAtMs - b[1].updatedAtMs,
  );
  for (const [key] of ordered.slice(0, Math.max(0, ordered.length - MAX_SESSIONS))) {
    sessions.delete(key);
  }
}

function ensureSession(sessionKey: string): SessionToolApprovals {
  pruneSessions();
  const existing = sessions.get(sessionKey);
  if (existing) {
    existing.updatedAtMs = Date.now();
    return existing;
  }
  const next: SessionToolApprovals = {
    updatedAtMs: Date.now(),
    files: {
      "fs.read": new Set<string>(),
      "fs.write": new Set<string>(),
    },
    browser: {
      "browser.read": false,
      "browser.control": false,
    },
  };
  sessions.set(sessionKey, next);
  return next;
}

export function hasSessionToolApproval(params: {
  sessionKey?: string | null;
  toolGroup: ToolApprovalToolGroup;
  target?: string | null;
}): boolean {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return false;
  }
  const entry = sessions.get(sessionKey);
  if (!entry) {
    return false;
  }
  entry.updatedAtMs = Date.now();
  if (params.toolGroup === "browser.read" || params.toolGroup === "browser.control") {
    return entry.browser[params.toolGroup];
  }
  const target = params.target?.trim();
  if (!target) {
    return false;
  }
  const patterns = entry.files[params.toolGroup];
  for (const pattern of patterns) {
    if (matchesToolApprovalPattern(pattern, target)) {
      return true;
    }
  }
  return false;
}

export function recordSessionToolApproval(params: {
  sessionKey?: string | null;
  toolGroup: ToolApprovalToolGroup;
  target?: string | null;
}): void {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  const entry = ensureSession(sessionKey);
  if (params.toolGroup === "browser.read" || params.toolGroup === "browser.control") {
    entry.browser[params.toolGroup] = true;
    return;
  }
  const target = params.target?.trim();
  if (!target) {
    return;
  }
  entry.files[params.toolGroup].add(target);
}
