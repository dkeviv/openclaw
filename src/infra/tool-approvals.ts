import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ToolApprovalDecision = "allow-once" | "allow-always" | "deny";

export type ToolApprovalToolGroup = "fs.read" | "fs.write" | "browser.read" | "browser.control";

export type ToolApprovalsEntry = {
  id: string;
  toolGroup: ToolApprovalToolGroup;
  pattern: string;
  createdAtMs: number;
  lastUsedAtMs?: number;
  lastExample?: string;
};

export type ToolApprovalsFile = {
  version: 1;
  entries?: ToolApprovalsEntry[];
};

export type ToolApprovalsSnapshot = {
  path: string;
  exists: boolean;
  raw: string | null;
  file: ToolApprovalsFile;
  hash: string;
};

const DEFAULT_FILE = "~/.openclaw/tool-approvals.json";

const KNOWN_TOOL_GROUPS = new Set<ToolApprovalToolGroup>([
  "fs.read",
  "fs.write",
  "browser.read",
  "browser.control",
]);

function hashToolApprovalsRaw(raw: string | null): string {
  return crypto
    .createHash("sha256")
    .update(raw ?? "")
    .digest("hex");
}

function expandHome(value: string): string {
  if (!value) {
    return value;
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveToolApprovalsPath(): string {
  return expandHome(DEFAULT_FILE);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function isToolGroup(value: unknown): value is ToolApprovalToolGroup {
  return typeof value === "string" && (KNOWN_TOOL_GROUPS as Set<string>).has(value);
}

function normalizeEntry(entry: unknown): ToolApprovalsEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const toolGroupRaw = record.toolGroup;
  const toolGroup = isToolGroup(toolGroupRaw) ? toolGroupRaw : null;
  const pattern = typeof record.pattern === "string" ? record.pattern.trim() : "";
  const createdAtMs = typeof record.createdAtMs === "number" ? record.createdAtMs : 0;
  if (!toolGroup || !pattern || !createdAtMs) {
    return null;
  }
  const lastUsedAtMs = typeof record.lastUsedAtMs === "number" ? record.lastUsedAtMs : undefined;
  const lastExample = typeof record.lastExample === "string" ? record.lastExample : undefined;
  return {
    id,
    toolGroup,
    pattern,
    createdAtMs,
    ...(typeof lastUsedAtMs === "number" && Number.isFinite(lastUsedAtMs) && lastUsedAtMs > 0
      ? { lastUsedAtMs }
      : {}),
    ...(lastExample ? { lastExample } : {}),
  };
}

export function normalizeToolApprovals(file: ToolApprovalsFile): ToolApprovalsFile {
  const entriesRaw = Array.isArray(file.entries) ? file.entries : [];
  const nextEntries: ToolApprovalsEntry[] = [];
  for (const entry of entriesRaw) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    nextEntries.push({
      ...normalized,
      id: normalized.id || crypto.randomUUID(),
    });
  }
  return {
    version: 1,
    entries: nextEntries.length ? nextEntries : undefined,
  };
}

export function readToolApprovalsSnapshot(): ToolApprovalsSnapshot {
  const filePath = resolveToolApprovalsPath();
  if (!fs.existsSync(filePath)) {
    const file = normalizeToolApprovals({ version: 1 });
    return {
      path: filePath,
      exists: false,
      raw: null,
      file,
      hash: hashToolApprovalsRaw(null),
    };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: ToolApprovalsFile | null = null;
  try {
    parsed = JSON.parse(raw) as ToolApprovalsFile;
  } catch {
    parsed = null;
  }
  const file =
    parsed?.version === 1 ? normalizeToolApprovals(parsed) : normalizeToolApprovals({ version: 1 });
  return {
    path: filePath,
    exists: true,
    raw,
    file,
    hash: hashToolApprovalsRaw(raw),
  };
}

export function loadToolApprovals(): ToolApprovalsFile {
  const filePath = resolveToolApprovalsPath();
  try {
    if (!fs.existsSync(filePath)) {
      return normalizeToolApprovals({ version: 1 });
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ToolApprovalsFile;
    if (parsed?.version !== 1) {
      return normalizeToolApprovals({ version: 1 });
    }
    return normalizeToolApprovals(parsed);
  } catch {
    return normalizeToolApprovals({ version: 1 });
  }
}

export function saveToolApprovals(file: ToolApprovalsFile) {
  const filePath = resolveToolApprovalsPath();
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
}

export function ensureToolApprovals(): ToolApprovalsFile {
  const loaded = loadToolApprovals();
  const next = normalizeToolApprovals(loaded);
  saveToolApprovals(next);
  return next;
}

function normalizeMatchTarget(value: string): string {
  if (process.platform === "win32") {
    const stripped = value.replace(/^\\\\[?.]\\/, "");
    return stripped.replace(/\\/g, "/").toLowerCase();
  }
  return value.replace(/\\\\/g, "/").toLowerCase();
}

function tryRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regex += ".";
      i += 1;
      continue;
    }
    regex += ch.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
    i += 1;
  }
  regex += "$";
  return new RegExp(regex, "i");
}

export function matchesToolApprovalPattern(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }
  const expanded = trimmed.startsWith("~") ? expandHome(trimmed) : trimmed;
  const hasWildcard = /[*?]/.test(expanded);
  let normalizedPattern = expanded;
  let normalizedTarget = target;
  if (process.platform === "win32" && !hasWildcard) {
    normalizedPattern = tryRealpath(expanded) ?? expanded;
    normalizedTarget = tryRealpath(target) ?? target;
  }
  normalizedPattern = normalizeMatchTarget(normalizedPattern);
  normalizedTarget = normalizeMatchTarget(normalizedTarget);
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedTarget);
}

export function resolveToolApprovalDirGlob(filePath: string): string {
  const resolved = filePath.trim().startsWith("~") ? expandHome(filePath.trim()) : filePath.trim();
  const dir = path.dirname(resolved);
  const suffix = dir.endsWith(path.sep) ? "**" : `${path.sep}**`;
  return `${dir}${suffix}`;
}

export function findToolApprovalMatch(params: {
  file: ToolApprovalsFile;
  toolGroup: ToolApprovalToolGroup;
  target: string;
}): ToolApprovalsEntry | null {
  const entries = Array.isArray(params.file.entries) ? params.file.entries : [];
  for (const entry of entries) {
    if (entry.toolGroup !== params.toolGroup) {
      continue;
    }
    if (matchesToolApprovalPattern(entry.pattern, params.target)) {
      return entry;
    }
  }
  return null;
}

export function recordToolApprovalUse(params: {
  file: ToolApprovalsFile;
  entryId: string;
  lastExample?: string;
}): ToolApprovalsFile {
  const entries = Array.isArray(params.file.entries) ? params.file.entries : [];
  if (entries.length === 0) {
    return params.file;
  }
  const now = Date.now();
  const nextEntries = entries.map((entry) => {
    if (entry.id !== params.entryId) {
      return entry;
    }
    return {
      ...entry,
      lastUsedAtMs: now,
      ...(params.lastExample ? { lastExample: params.lastExample } : {}),
    };
  });
  return { ...params.file, entries: nextEntries };
}

export function addToolApprovalEntry(params: {
  file: ToolApprovalsFile;
  toolGroup: ToolApprovalToolGroup;
  pattern: string;
  lastExample?: string;
}): ToolApprovalsFile {
  const pattern = params.pattern.trim();
  if (!pattern) {
    return params.file;
  }
  const entries = Array.isArray(params.file.entries) ? params.file.entries : [];
  if (entries.some((entry) => entry.toolGroup === params.toolGroup && entry.pattern === pattern)) {
    return params.file;
  }
  const createdAtMs = Date.now();
  const next: ToolApprovalsEntry = {
    id: crypto.randomUUID(),
    toolGroup: params.toolGroup,
    pattern,
    createdAtMs,
    ...(params.lastExample ? { lastExample: params.lastExample } : {}),
    lastUsedAtMs: createdAtMs,
  };
  return {
    ...params.file,
    entries: [...entries, next],
  };
}
