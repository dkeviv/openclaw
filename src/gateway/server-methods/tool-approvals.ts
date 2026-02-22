import {
  ensureToolApprovals,
  normalizeToolApprovals,
  readToolApprovalsSnapshot,
  saveToolApprovals,
  type ToolApprovalsFile,
  type ToolApprovalsSnapshot,
} from "../../infra/tool-approvals.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateToolApprovalsGetParams,
  validateToolApprovalsSetParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function resolveBaseHash(params: unknown): string | null {
  const raw = (params as { baseHash?: unknown })?.baseHash;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function requireApprovalsBaseHash(
  params: unknown,
  snapshot: ToolApprovalsSnapshot,
  respond: RespondFn,
): boolean {
  if (!snapshot.exists) {
    return true;
  }
  if (!snapshot.hash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "tool approvals base hash unavailable; re-run tool.approvals.get and retry",
      ),
    );
    return false;
  }
  const baseHash = resolveBaseHash(params);
  if (!baseHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "tool approvals base hash required; re-run tool.approvals.get and retry",
      ),
    );
    return false;
  }
  if (baseHash !== snapshot.hash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "tool approvals changed since last load; re-run tool.approvals.get and retry",
      ),
    );
    return false;
  }
  return true;
}

export const toolApprovalsHandlers: GatewayRequestHandlers = {
  "tool.approvals.get": ({ params, respond }) => {
    if (!validateToolApprovalsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tool.approvals.get params: ${formatValidationErrors(validateToolApprovalsGetParams.errors)}`,
        ),
      );
      return;
    }
    ensureToolApprovals();
    const snapshot = readToolApprovalsSnapshot();
    respond(
      true,
      {
        path: snapshot.path,
        exists: snapshot.exists,
        hash: snapshot.hash,
        file: snapshot.file,
      },
      undefined,
    );
  },
  "tool.approvals.set": ({ params, respond }) => {
    if (!validateToolApprovalsSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tool.approvals.set params: ${formatValidationErrors(validateToolApprovalsSetParams.errors)}`,
        ),
      );
      return;
    }
    ensureToolApprovals();
    const snapshot = readToolApprovalsSnapshot();
    if (!requireApprovalsBaseHash(params, snapshot, respond)) {
      return;
    }
    const incoming = (params as { file?: unknown }).file;
    if (!incoming || typeof incoming !== "object") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tool approvals file is required"),
      );
      return;
    }
    const normalized = normalizeToolApprovals(incoming as ToolApprovalsFile);
    saveToolApprovals(normalized);
    const nextSnapshot = readToolApprovalsSnapshot();
    respond(
      true,
      {
        path: nextSnapshot.path,
        exists: nextSnapshot.exists,
        hash: nextSnapshot.hash,
        file: nextSnapshot.file,
      },
      undefined,
    );
  },
};
