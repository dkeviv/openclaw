import type { ToolApprovalDecision } from "../../infra/tool-approvals.js";
import type { ToolApprovalManager } from "../tool-approval-manager.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateToolApprovalRequestParams,
  validateToolApprovalResolveParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;

export function createToolApprovalHandlers(manager: ToolApprovalManager): GatewayRequestHandlers {
  return {
    "tool.approval.request": async ({ params, respond, context }) => {
      if (!validateToolApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid tool.approval.request params: ${formatValidationErrors(
              validateToolApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        id?: string;
        toolName: string;
        toolGroup: string;
        summary: string;
        cwd?: string;
        agentId?: string;
        sessionKey?: string;
        target?: string;
        targets?: string[];
        allowAlways?: boolean;
        timeoutMs?: number;
      };
      const timeoutMs =
        typeof p.timeoutMs === "number" && Number.isFinite(p.timeoutMs)
          ? Math.max(1, Math.floor(p.timeoutMs))
          : DEFAULT_APPROVAL_TIMEOUT_MS;
      const explicitId = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : null;
      if (explicitId && manager.getSnapshot(explicitId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "approval id already pending"),
        );
        return;
      }
      const request = {
        toolName: p.toolName,
        toolGroup: p.toolGroup,
        summary: p.summary,
        cwd: typeof p.cwd === "string" ? p.cwd : null,
        agentId: typeof p.agentId === "string" ? p.agentId : null,
        sessionKey: typeof p.sessionKey === "string" ? p.sessionKey : null,
        target: typeof p.target === "string" ? p.target : null,
        targets: Array.isArray(p.targets)
          ? p.targets.filter((entry): entry is string => typeof entry === "string")
          : null,
        allowAlways: typeof p.allowAlways === "boolean" ? p.allowAlways : null,
      };
      const record = manager.create(request, timeoutMs, explicitId);
      const decisionPromise = manager.waitForDecision(record, timeoutMs);
      context.broadcast(
        "tool.approval.requested",
        {
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const decision = await decisionPromise;
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
    "tool.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validateToolApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid tool.approval.resolve params: ${formatValidationErrors(
              validateToolApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; decision: string };
      const decision = p.decision as ToolApprovalDecision;
      if (decision !== "allow-once" && decision !== "allow-always" && decision !== "deny") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
        return;
      }
      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const ok = manager.resolve(p.id, decision, resolvedBy ?? null);
      if (!ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown approval id"));
        return;
      }
      context.broadcast(
        "tool.approval.resolved",
        { id: p.id, decision, resolvedBy, ts: Date.now() },
        { dropIfSlow: true },
      );
      respond(true, { ok: true }, undefined);
    },
  };
}
