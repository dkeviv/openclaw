import { Type } from "@sinclair/typebox";

import { NonEmptyString } from "./primitives.js";

export const ToolApprovalsEntrySchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    toolGroup: NonEmptyString,
    pattern: Type.String(),
    createdAtMs: Type.Integer({ minimum: 0 }),
    lastUsedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    lastExample: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ToolApprovalsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    entries: Type.Optional(Type.Array(ToolApprovalsEntrySchema)),
  },
  { additionalProperties: false },
);

export const ToolApprovalsSnapshotSchema = Type.Object(
  {
    path: NonEmptyString,
    exists: Type.Boolean(),
    hash: NonEmptyString,
    file: ToolApprovalsFileSchema,
  },
  { additionalProperties: false },
);

export const ToolApprovalsGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const ToolApprovalsSetParamsSchema = Type.Object(
  {
    file: ToolApprovalsFileSchema,
    baseHash: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ToolApprovalRequestParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    toolName: NonEmptyString,
    toolGroup: NonEmptyString,
    summary: NonEmptyString,
    cwd: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    target: Type.Optional(Type.String()),
    targets: Type.Optional(Type.Array(Type.String())),
    allowAlways: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const ToolApprovalResolveParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    decision: NonEmptyString,
  },
  { additionalProperties: false },
);
