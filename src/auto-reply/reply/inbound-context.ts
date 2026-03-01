import { normalizeChatType } from "../../channels/chat-type.js";
import { resolveConversationLabel } from "../../channels/conversation-label.js";
import type { FinalizedMsgContext, MsgContext } from "../templating.js";
import { formatInboundBodyWithSenderMeta } from "./inbound-sender-meta.js";
import { normalizeInboundTextNewlines } from "./inbound-text.js";

export type FinalizeInboundContextOptions = {
  forceBodyForAgent?: boolean;
  forceBodyForCommands?: boolean;
  forceChatType?: boolean;
  forceConversationLabel?: boolean;
};

function sanitizeSpoofedSystemMessagePrefix(value: string): string {
  const trimmed = value.trimStart();
  if (!trimmed) return value;
  // Treat user-provided "[System Message] ..." as untrusted content to prevent
  // spoofing internal system-event semantics in model context.
  if (/^\[\s*system\s+message\s*\]/i.test(trimmed)) {
    return value.replace(/^(\s*)\[(\s*system\s+message\s*)\]/i, "$1[Untrusted message]");
  }
  return value;
}

function normalizeTextField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return sanitizeSpoofedSystemMessagePrefix(normalizeInboundTextNewlines(value));
}

export function finalizeInboundContext<T extends Record<string, unknown>>(
  ctx: T,
  opts: FinalizeInboundContextOptions = {},
): T & FinalizedMsgContext {
  const normalized = ctx as T & MsgContext;

  normalized.Body = sanitizeSpoofedSystemMessagePrefix(
    normalizeInboundTextNewlines(typeof normalized.Body === "string" ? normalized.Body : ""),
  );
  normalized.RawBody = normalizeTextField(normalized.RawBody);
  normalized.CommandBody = normalizeTextField(normalized.CommandBody);
  normalized.Transcript = normalizeTextField(normalized.Transcript);
  normalized.ThreadStarterBody = normalizeTextField(normalized.ThreadStarterBody);

  const chatType = normalizeChatType(normalized.ChatType);
  if (chatType && (opts.forceChatType || normalized.ChatType !== chatType)) {
    normalized.ChatType = chatType;
  }

  const bodyForAgentSource = opts.forceBodyForAgent
    ? normalized.Body
    : (normalized.BodyForAgent ?? normalized.Body);
  normalized.BodyForAgent = sanitizeSpoofedSystemMessagePrefix(
    normalizeInboundTextNewlines(bodyForAgentSource),
  );

  const bodyForCommandsSource = opts.forceBodyForCommands
    ? (normalized.CommandBody ?? normalized.RawBody ?? normalized.Body)
    : (normalized.BodyForCommands ??
      normalized.CommandBody ??
      normalized.RawBody ??
      normalized.Body);
  normalized.BodyForCommands = sanitizeSpoofedSystemMessagePrefix(
    normalizeInboundTextNewlines(bodyForCommandsSource),
  );

  const explicitLabel = normalized.ConversationLabel?.trim();
  if (opts.forceConversationLabel || !explicitLabel) {
    const resolved = resolveConversationLabel(normalized)?.trim();
    if (resolved) {
      normalized.ConversationLabel = resolved;
    }
  } else {
    normalized.ConversationLabel = explicitLabel;
  }

  // Ensure group/channel messages retain a sender meta line even when the body is a
  // structured envelope (e.g. "[Signal ...] Alice: hi").
  normalized.Body = formatInboundBodyWithSenderMeta({ ctx: normalized, body: normalized.Body });
  normalized.BodyForAgent = formatInboundBodyWithSenderMeta({
    ctx: normalized,
    body: normalized.BodyForAgent,
  });

  // Always set. Default-deny when upstream forgets to populate it.
  normalized.CommandAuthorized = normalized.CommandAuthorized === true;

  return normalized as T & FinalizedMsgContext;
}
