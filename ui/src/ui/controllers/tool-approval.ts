export type ToolApprovalRequestPayload = {
  toolName: string;
  toolGroup: string;
  summary: string;
  cwd?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  target?: string | null;
  targets?: string[] | null;
  allowAlways?: boolean | null;
};

export type ToolApprovalRequest = {
  id: string;
  request: ToolApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ToolApprovalResolved = {
  id: string;
  decision?: string | null;
  resolvedBy?: string | null;
  ts?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseToolApprovalRequested(payload: unknown): ToolApprovalRequest | null {
  if (!isRecord(payload)) return null;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const request = payload.request;
  if (!id || !isRecord(request)) return null;
  const toolName = typeof request.toolName === "string" ? request.toolName.trim() : "";
  const toolGroup = typeof request.toolGroup === "string" ? request.toolGroup.trim() : "";
  const summary = typeof request.summary === "string" ? request.summary.trim() : "";
  if (!toolName || !toolGroup || !summary) return null;
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) return null;
  const target = typeof request.target === "string" ? request.target : null;
  const targetsRaw = request.targets;
  const targets = Array.isArray(targetsRaw)
    ? targetsRaw.filter((entry): entry is string => typeof entry === "string" && entry.trim())
    : null;
  return {
    id,
    request: {
      toolName,
      toolGroup,
      summary,
      cwd: typeof request.cwd === "string" ? request.cwd : null,
      agentId: typeof request.agentId === "string" ? request.agentId : null,
      sessionKey: typeof request.sessionKey === "string" ? request.sessionKey : null,
      target,
      targets: targets && targets.length ? targets : null,
      allowAlways: typeof request.allowAlways === "boolean" ? request.allowAlways : null,
    },
    createdAtMs,
    expiresAtMs,
  };
}

export function parseToolApprovalResolved(payload: unknown): ToolApprovalResolved | null {
  if (!isRecord(payload)) return null;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return null;
  return {
    id,
    decision: typeof payload.decision === "string" ? payload.decision : null,
    resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : null,
    ts: typeof payload.ts === "number" ? payload.ts : null,
  };
}

export function pruneToolApprovalQueue(queue: ToolApprovalRequest[]): ToolApprovalRequest[] {
  const now = Date.now();
  return queue.filter((entry) => entry.expiresAtMs > now);
}

export function addToolApproval(
  queue: ToolApprovalRequest[],
  entry: ToolApprovalRequest,
): ToolApprovalRequest[] {
  const next = pruneToolApprovalQueue(queue).filter((item) => item.id !== entry.id);
  next.push(entry);
  return next;
}

export function removeToolApproval(
  queue: ToolApprovalRequest[],
  id: string,
): ToolApprovalRequest[] {
  return pruneToolApprovalQueue(queue).filter((entry) => entry.id !== id);
}
