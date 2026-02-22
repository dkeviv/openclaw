import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway";
import { resolveInjectedAssistantIdentity } from "./assistant-identity";
import { loadSettings, type UiSettings } from "./storage";
import { renderApp } from "./app-render";
import type { Tab } from "./navigation";
import type { ResolvedTheme, ThemeMode } from "./theme";
import type {
  AgentsListResult,
  ConfigSnapshot,
  ConfigUiHints,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  NostrProfile,
} from "./types";
import { type ChatAttachment, type ChatQueueItem, type CronFormState } from "./ui-types";
import type { EventLogEntry } from "./app-events";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals";
import type { DevicePairingList } from "./controllers/devices";
import type { ExecApprovalRequest } from "./controllers/exec-approval";
import type { ToolApprovalRequest } from "./controllers/tool-approval";
import {
  resetToolStream as resetToolStreamInternal,
  type ToolStreamEntry,
} from "./app-tool-stream";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
} from "./app-scroll";
import { connectGateway as connectGatewayInternal } from "./app-gateway";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadOverview as loadOverviewInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat";
import {
  handleChannelConfigReload as handleChannelConfigReloadInternal,
  handleChannelConfigSave as handleChannelConfigSaveInternal,
  handleNostrProfileCancel as handleNostrProfileCancelInternal,
  handleNostrProfileEdit as handleNostrProfileEditInternal,
  handleNostrProfileFieldChange as handleNostrProfileFieldChangeInternal,
  handleNostrProfileImport as handleNostrProfileImportInternal,
  handleNostrProfileSave as handleNostrProfileSaveInternal,
  handleNostrProfileToggleAdvanced as handleNostrProfileToggleAdvancedInternal,
  handleWhatsAppLogout as handleWhatsAppLogoutInternal,
  handleWhatsAppStart as handleWhatsAppStartInternal,
  handleWhatsAppWait as handleWhatsAppWaitInternal,
} from "./app-channels";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity";

declare global {
  interface Window {
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
    __OPENCLAW_BRAND__?: string;
    __MINDFLY_ACCENT__?: string;
    __OPENCLAW_GATEWAY_TOKEN__?: string;
  }
}

const injectedAssistantIdentity = resolveInjectedAssistantIdentity();

function resolveOnboardingMode(): boolean {
  if (!window.location.search) return false;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

type UiBrand = "openclaw" | "mindfly";

function resolveBrandMode(): UiBrand {
  if (typeof window === "undefined") return "openclaw";
  const params = new URLSearchParams(window.location.search ?? "");
  const rawParam = (params.get("brand") ?? params.get("product") ?? "").trim().toLowerCase();
  const rawInjected = (window.__OPENCLAW_BRAND__ ?? "").trim().toLowerCase();
  const raw = rawParam || rawInjected;
  return raw === "mindfly" ? "mindfly" : "openclaw";
}

function resolveMindflyAccent(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search ?? "");
  const rawParam = (params.get("accent") ?? "").trim();
  const rawInjected = (window.__MINDFLY_ACCENT__ ?? "").trim();
  const raw = rawParam || rawInjected;
  return raw ? raw : null;
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }
  return { r, g, b };
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const to2 = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

function lighten(rgb: { r: number; g: number; b: number }, amount: number): { r: number; g: number; b: number } {
  const a = Math.max(0, Math.min(1, amount));
  return {
    r: rgb.r + (255 - rgb.r) * a,
    g: rgb.g + (255 - rgb.g) * a,
    b: rgb.b + (255 - rgb.b) * a,
  };
}

function rgba(rgb: { r: number; g: number; b: number }, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)}, ${a})`;
}

function applyBrandTheme(brand: UiBrand, accent: string | null) {
  const root = document.documentElement;
  root.dataset.brand = brand;
  if (brand !== "mindfly") {
    return;
  }
  const base = parseHexColor(accent ?? "") ?? parseHexColor("#7C5CFF");
  if (!base) return;
  const hover = lighten(base, 0.1);
  root.style.setProperty("--mindfly-accent", rgbToHex(base));
  root.style.setProperty("--accent", rgbToHex(base));
  root.style.setProperty("--primary", rgbToHex(base));
  root.style.setProperty("--ring", rgbToHex(base));
  root.style.setProperty("--accent-hover", rgbToHex(hover));
  root.style.setProperty("--accent-muted", rgbToHex(base));
  root.style.setProperty("--accent-subtle", rgba(base, 0.15));
  root.style.setProperty("--accent-glow", rgba(base, 0.25));
  root.style.setProperty("--focus", rgba(base, 0.25));
}

@customElement("openclaw-app")
export class OpenClawApp extends LitElement {
  @state() settings: UiSettings = loadSettings();
  @state() password = "";
  @state() tab: Tab = "chat";
  @state() onboarding = resolveOnboardingMode();
  @state() brand: UiBrand = resolveBrandMode();
  @state() mindflyAccent: string | null = resolveMindflyAccent();
  @state() mindflyIdentity: {
    email: string;
    name?: string;
    picture?: string;
    id?: string;
    expiresAtMs: number;
  } | null = null;
  @state() mindflyIdentityLoading = false;
  @state() mindflyIdentityError: string | null = null;
  @state() mindflyAuthBusy = false;

  @state() mindflyProviders: Array<{ id: string; label: string; configured: boolean }> = [];
  @state() mindflyProvidersLoading = false;
  @state() mindflyProvidersError: string | null = null;
  @state() mindflyApiKeyProvider = "anthropic";
  @state() mindflyApiKey = "";
  @state() mindflyApiKeySaving = false;
  @state() mindflyApiKeyError: string | null = null;

  @state() mindflyModels: Array<{ id: string; name: string; provider: string }> = [];
  @state() mindflyModelsLoading = false;
  @state() mindflyModelsError: string | null = null;

  @state() mindflyOnboardingStep = 0;
  @state() mindflyOnboardingBrowserEnabled = true;
  @state() mindflyOnboardingProvider = "anthropic";
  @state() mindflyOnboardingApiKey = "";
  @state() mindflyOnboardingModel = "";
  @state() mindflyOnboardingAssistantName = "Assistant";
  @state() mindflyOnboardingAssistantAvatar = "🦋";
  @state() mindflyOnboardingBusy = false;
  @state() mindflyOnboardingError: string | null = null;
  @state() mindflyOnboardingFinishing = false;
  @state() mindflyOnboardingFinishRequested = false;
  @state() connected = false;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = injectedAssistantIdentity.name;
  @state() assistantAvatar = injectedAssistantIdentity.avatar;
  @state() assistantAgentId = injectedAssistantIdentity.agentId ?? null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatToolMessages: unknown[] = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  @state() compactionStatus: import("./app-tool-stream").CompactionStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  // Sidebar state for tool output viewing
  @state() sidebarOpen = false;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;

  @state() nodesLoading = false;
  @state() nodes: Array<Record<string, unknown>> = [];
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;
  @state() toolApprovalQueue: ToolApprovalRequest[] = [];
  @state() toolApprovalBusy = false;
  @state() toolApprovalError: string | null = null;
  @state() pendingGatewayUrl: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown | null = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() nostrProfileFormState: NostrProfileFormState | null = null;
  @state() nostrProfileAccountId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;

  @state() cronLoading = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronRunsJobId: string | null = null;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronBusy = false;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSnapshot | null = null;
  @state() debugModels: unknown[] = [];
  @state() debugHeartbeat: unknown | null = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  private nodesPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  refreshSessionsAfterChat = new Set<string>();
  basePath = "";
  private popStateHandler = () =>
    onPopStateInternal(this as unknown as Parameters<typeof onPopStateInternal>[0]);
  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
  private topbarObserver: ResizeObserver | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    handleConnected(this as unknown as Parameters<typeof handleConnected>[0]);
  }

  protected firstUpdated() {
    applyBrandTheme(this.brand, this.mindflyAccent);
    handleFirstUpdated(this as unknown as Parameters<typeof handleFirstUpdated>[0]);
  }

  disconnectedCallback() {
    handleDisconnected(this as unknown as Parameters<typeof handleDisconnected>[0]);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(this as unknown as Parameters<typeof handleUpdated>[0], changed);
    if (changed.has("connected") && this.connected && this.brand === "mindfly") {
      void this.refreshMindflyState();
      if (this.mindflyOnboardingFinishRequested) {
        this.mindflyOnboardingFinishRequested = false;
        this.mindflyOnboardingFinishing = false;
        try {
          localStorage.setItem("mindfly.onboardingSeen.v1", "1");
        } catch {
          // ignore storage errors
        }
        this.onboarding = false;
        this.setTab("chat");
      }
    }
  }

  connect() {
    connectGatewayInternal(this as unknown as Parameters<typeof connectGatewayInternal>[0]);
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(
      this as unknown as Parameters<typeof handleChatScrollInternal>[0],
      event,
    );
  }

  handleLogsScroll(event: Event) {
    handleLogsScrollInternal(
      this as unknown as Parameters<typeof handleLogsScrollInternal>[0],
      event,
    );
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    resetToolStreamInternal(this as unknown as Parameters<typeof resetToolStreamInternal>[0]);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }

  private async refreshMindflyState() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    await Promise.all([this.loadMindflyIdentity(), this.loadMindflyProviders()]);
    if (!this.mindflyIdentity) {
      this.onboarding = true;
      this.mindflyOnboardingStep = 0;
    }
  }

  private normalizeMindflyIdentity(value: unknown) {
    if (!value || typeof value !== "object") return null;
    const rec = value as Record<string, unknown>;
    const email = typeof rec.email === "string" ? rec.email.trim() : "";
    const expiresAtMs =
      typeof rec.expiresAtMs === "number" && Number.isFinite(rec.expiresAtMs) ? rec.expiresAtMs : 0;
    if (!email || expiresAtMs <= 0) return null;
    const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : undefined;
    const picture =
      typeof rec.picture === "string" && rec.picture.trim() ? rec.picture.trim() : undefined;
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;
    return { email, expiresAtMs, ...(name ? { name } : {}), ...(picture ? { picture } : {}), ...(id ? { id } : {}) };
  }

  async loadMindflyIdentity() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyIdentityLoading = true;
    this.mindflyIdentityError = null;
    try {
      const res = (await this.client.request("mindfly.google.identity.get", {})) as
        | { identity?: unknown }
        | undefined;
      const identity = this.normalizeMindflyIdentity(res?.identity ?? null);
      this.mindflyIdentity = identity;
    } catch (err) {
      this.mindflyIdentity = null;
      this.mindflyIdentityError = String(err);
    } finally {
      this.mindflyIdentityLoading = false;
    }
  }

  async mindflyGoogleSignIn() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyAuthBusy = true;
    this.mindflyIdentityError = null;
    try {
      const started = (await this.client.request("mindfly.google.signin.start", {})) as
        | { sessionId?: unknown; authUrl?: unknown }
        | undefined;
      const sessionId = typeof started?.sessionId === "string" ? started.sessionId.trim() : "";
      const authUrl = typeof started?.authUrl === "string" ? started.authUrl.trim() : "";
      if (!sessionId || !authUrl) {
        throw new Error("google sign-in did not return an auth URL");
      }
      const popup = window.open(authUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        this.mindflyIdentityError = `Popup blocked. Open this URL to continue:\n${authUrl}`;
      }
      const waited = (await this.client.request("mindfly.google.signin.wait", {
        sessionId,
        timeoutMs: 5 * 60 * 1000,
      })) as { identity?: unknown } | undefined;
      const identity = this.normalizeMindflyIdentity(waited?.identity ?? null);
      if (!identity) {
        throw new Error("google sign-in completed but identity was missing");
      }
      this.mindflyIdentity = identity;
      this.mindflyOnboardingStep = Math.max(this.mindflyOnboardingStep, 1);
    } catch (err) {
      this.mindflyIdentityError = String(err);
    } finally {
      this.mindflyAuthBusy = false;
    }
  }

  async mindflyGoogleSignOut() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyAuthBusy = true;
    this.mindflyIdentityError = null;
    try {
      await this.client.request("mindfly.google.signout", {});
      this.mindflyIdentity = null;
    } catch (err) {
      this.mindflyIdentityError = String(err);
    } finally {
      this.mindflyAuthBusy = false;
    }
  }

  async loadMindflyProviders() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyProvidersLoading = true;
    this.mindflyProvidersError = null;
    try {
      const res = (await this.client.request("mindfly.integrations.providers.list", {})) as
        | { providers?: unknown }
        | undefined;
      const list = Array.isArray(res?.providers) ? (res?.providers as unknown[]) : [];
      const providers = list
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const rec = entry as Record<string, unknown>;
          const id = typeof rec.id === "string" ? rec.id.trim() : "";
          const label = typeof rec.label === "string" ? rec.label.trim() : "";
          const configured = rec.configured === true;
          if (!id || !label) return null;
          return { id, label, configured };
        })
        .filter(Boolean) as Array<{ id: string; label: string; configured: boolean }>;
      this.mindflyProviders = providers;
      if (!providers.some((p) => p.id === this.mindflyApiKeyProvider)) {
        this.mindflyApiKeyProvider = providers[0]?.id ?? this.mindflyApiKeyProvider;
      }
    } catch (err) {
      this.mindflyProvidersError = String(err);
    } finally {
      this.mindflyProvidersLoading = false;
    }
  }

  async mindflySaveApiKey(provider?: string, apiKey?: string) {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyApiKeySaving = true;
    this.mindflyApiKeyError = null;
    try {
      const targetProvider = (provider ?? this.mindflyApiKeyProvider).trim();
      const key = (apiKey ?? this.mindflyApiKey).trim();
      if (!targetProvider || !key) {
        throw new Error("provider and api key are required");
      }
      await this.client.request("mindfly.integrations.provider.apiKey.set", {
        provider: targetProvider,
        apiKey: key,
      });
      this.mindflyApiKey = "";
      this.mindflyOnboardingApiKey = "";
      this.mindflyOnboardingProvider = targetProvider;
      await this.loadMindflyProviders();
    } catch (err) {
      this.mindflyApiKeyError = String(err);
      this.mindflyOnboardingError = String(err);
    } finally {
      this.mindflyApiKeySaving = false;
    }
  }

  async mindflyClearApiKey(provider: string) {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    const ok = window.confirm(`Remove the stored API key for ${provider}?`);
    if (!ok) return;
    this.mindflyApiKeySaving = true;
    this.mindflyApiKeyError = null;
    try {
      await this.client.request("mindfly.integrations.provider.apiKey.clear", { provider });
      await this.loadMindflyProviders();
    } catch (err) {
      this.mindflyApiKeyError = String(err);
    } finally {
      this.mindflyApiKeySaving = false;
    }
  }

  async loadMindflyModels() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyModelsLoading = true;
    this.mindflyModelsError = null;
    try {
      const res = (await this.client.request("models.list", {})) as { models?: unknown } | undefined;
      const list = Array.isArray(res?.models) ? (res.models as unknown[]) : [];
      const models = list
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const rec = entry as Record<string, unknown>;
          const id = typeof rec.id === "string" ? rec.id.trim() : "";
          const name = typeof rec.name === "string" ? rec.name.trim() : "";
          const provider = typeof rec.provider === "string" ? rec.provider.trim() : "";
          if (!id || !name || !provider) return null;
          return { id, name, provider };
        })
        .filter(Boolean) as Array<{ id: string; name: string; provider: string }>;
      this.mindflyModels = models;
    } catch (err) {
      this.mindflyModelsError = String(err);
    } finally {
      this.mindflyModelsLoading = false;
    }
  }

  async mindflyFinishOnboarding() {
    if (this.brand !== "mindfly") return;
    if (!this.client || !this.connected) return;
    this.mindflyOnboardingFinishing = true;
    this.mindflyOnboardingError = null;
    try {
      const snapshot = (await this.client.request("config.get", {})) as
        | { exists?: unknown; hash?: unknown }
        | undefined;
      const baseHash = typeof snapshot?.hash === "string" ? snapshot.hash.trim() : undefined;
      const patch = {
        ui: {
          seamColor: this.mindflyAccent ?? undefined,
          assistant: {
            name: this.mindflyOnboardingAssistantName.trim() || undefined,
            avatar: this.mindflyOnboardingAssistantAvatar.trim() || undefined,
          },
        },
        browser: {
          enabled: this.mindflyOnboardingBrowserEnabled,
          evaluateEnabled: false,
        },
        agents: {
          defaults: {
            model: {
              primary: this.mindflyOnboardingModel.trim() || undefined,
            },
          },
        },
      };
      const raw = JSON.stringify(patch, null, 2);
      await this.client.request("config.patch", {
        raw,
        ...(baseHash ? { baseHash } : {}),
        note: "Mindfly onboarding",
      });
      this.mindflyOnboardingFinishRequested = true;
    } catch (err) {
      this.mindflyOnboardingError = String(err);
      this.mindflyOnboardingFinishing = false;
    }
  }

  applySettings(next: UiSettings) {
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], next);
  }

  setTab(next: Tab) {
    setTabInternal(this as unknown as Parameters<typeof setTabInternal>[0], next);
  }

  setTheme(next: ThemeMode, context?: Parameters<typeof setThemeInternal>[2]) {
    setThemeInternal(this as unknown as Parameters<typeof setThemeInternal>[0], next, context);
  }

  async loadOverview() {
    await loadOverviewInternal(this as unknown as Parameters<typeof loadOverviewInternal>[0]);
  }

  async loadCron() {
    await loadCronInternal(this as unknown as Parameters<typeof loadCronInternal>[0]);
  }

  async handleAbortChat() {
    await handleAbortChatInternal(this as unknown as Parameters<typeof handleAbortChatInternal>[0]);
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(
      this as unknown as Parameters<typeof removeQueuedMessageInternal>[0],
      id,
    );
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
  }

  async handleWhatsAppStart(force: boolean) {
    await handleWhatsAppStartInternal(this, force);
  }

  async handleWhatsAppWait() {
    await handleWhatsAppWaitInternal(this);
  }

  async handleWhatsAppLogout() {
    await handleWhatsAppLogoutInternal(this);
  }

  async handleChannelConfigSave() {
    await handleChannelConfigSaveInternal(this);
  }

  async handleChannelConfigReload() {
    await handleChannelConfigReloadInternal(this);
  }

  handleNostrProfileEdit(accountId: string, profile: NostrProfile | null) {
    handleNostrProfileEditInternal(this, accountId, profile);
  }

  handleNostrProfileCancel() {
    handleNostrProfileCancelInternal(this);
  }

  handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    handleNostrProfileFieldChangeInternal(this, field, value);
  }

  async handleNostrProfileSave() {
    await handleNostrProfileSaveInternal(this);
  }

  async handleNostrProfileImport() {
    await handleNostrProfileImportInternal(this);
  }

  handleNostrProfileToggleAdvanced() {
    handleNostrProfileToggleAdvancedInternal(this);
  }

  async handleExecApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) return;
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      await this.client.request("exec.approval.resolve", {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Exec approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }

  async handleToolApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.toolApprovalQueue[0];
    if (!active || !this.client || this.toolApprovalBusy) return;
    this.toolApprovalBusy = true;
    this.toolApprovalError = null;
    try {
      await this.client.request("tool.approval.resolve", {
        id: active.id,
        decision,
      });
      this.toolApprovalQueue = this.toolApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.toolApprovalError = `Tool approval failed: ${String(err)}`;
    } finally {
      this.toolApprovalBusy = false;
    }
  }

  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) return;
    this.pendingGatewayUrl = null;
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
    });
    this.connect();
  }

  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
  }

  // Sidebar handlers for tool output viewing
  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleCloseSidebar() {
    this.sidebarOpen = false;
    // Clear content after transition
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) return;
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }

  handleSplitRatioChange(ratio: number) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }

  render() {
    return renderApp(this);
  }
}
