import { html, nothing } from "lit";

import type { AppViewState } from "../app-view-state";

function formatRemaining(ms: number): string {
  const remaining = Math.max(0, ms);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function renderMetaRow(label: string, value?: string | null) {
  if (!value) return nothing;
  return html`<div class="exec-approval-meta-row"><span>${label}</span><span>${value}</span></div>`;
}

function formatTargets(state: AppViewState): string | null {
  const active = state.toolApprovalQueue[0];
  const request = active?.request;
  if (!request) return null;
  const targets = Array.isArray(request.targets)
    ? request.targets.filter((entry) => typeof entry === "string" && entry.trim())
    : request.target
      ? [request.target]
      : [];
  if (targets.length === 0) return null;
  if (targets.length === 1) return targets[0];
  return `Targets:\n${targets.map((t) => `- ${t}`).join("\n")}`;
}

export function renderToolApprovalPrompt(state: AppViewState) {
  const active = state.toolApprovalQueue[0];
  if (!active) return nothing;
  const request = active.request;
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining = remainingMs > 0 ? `expires in ${formatRemaining(remainingMs)}` : "expired";
  const queueCount = state.toolApprovalQueue.length;
  const targetsText = formatTargets(state);
  const allowAlways = Boolean(request.allowAlways);

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Permission request</div>
            <div class="exec-approval-sub">${remaining}</div>
          </div>
          ${
            queueCount > 1
              ? html`<div class="exec-approval-queue">${queueCount} pending</div>`
              : nothing
          }
        </div>
        <div class="exec-approval-command mono">${request.summary}</div>
        ${targetsText ? html`<div class="exec-approval-command mono">${targetsText}</div>` : nothing}
        <div class="exec-approval-meta">
          ${renderMetaRow("Tool", request.toolName)}
          ${renderMetaRow("Group", request.toolGroup)}
          ${renderMetaRow("Agent", request.agentId)}
          ${renderMetaRow("Session", request.sessionKey)}
          ${renderMetaRow("CWD", request.cwd)}
        </div>
        ${
          state.toolApprovalError
            ? html`<div class="exec-approval-error">${state.toolApprovalError}</div>`
            : nothing
        }
        <div class="exec-approval-actions">
          <button
            class="btn primary"
            ?disabled=${state.toolApprovalBusy}
            @click=${() => state.handleToolApprovalDecision("allow-once")}
          >
            Allow once
          </button>
          ${
            allowAlways
              ? html`<button
                  class="btn"
                  ?disabled=${state.toolApprovalBusy}
                  @click=${() => state.handleToolApprovalDecision("allow-always")}
                >
                  Always allow
                </button>`
              : nothing
          }
          <button
            class="btn danger"
            ?disabled=${state.toolApprovalBusy}
            @click=${() => state.handleToolApprovalDecision("deny")}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  `;
}
