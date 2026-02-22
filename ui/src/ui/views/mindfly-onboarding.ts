import { html, nothing } from "lit";

import type { MindflyProviderStatus } from "./integrations";

export type MindflyOnboardingProps = {
  connected: boolean;
  identity: { email: string; name?: string; picture?: string } | null;
  identityLoading: boolean;
  identityError: string | null;
  authBusy: boolean;
  onGoogleSignIn: () => void;
  providers: MindflyProviderStatus[];
  providersLoading: boolean;
  providersError: string | null;
  onProvidersRefresh: () => void;
  onApiKeySave: (provider: string, apiKey: string) => void;
  models: Array<{ id: string; name: string; provider: string }>;
  modelsLoading: boolean;
  modelsError: string | null;
  onModelsLoad: () => void;
  step: number;
  setStep: (next: number) => void;
  browserEnabled: boolean;
  setBrowserEnabled: (next: boolean) => void;
  provider: string;
  setProvider: (next: string) => void;
  apiKey: string;
  setApiKey: (next: string) => void;
  model: string;
  setModel: (next: string) => void;
  assistantName: string;
  setAssistantName: (next: string) => void;
  assistantAvatar: string;
  setAssistantAvatar: (next: string) => void;
  error: string | null;
  finishing: boolean;
  onFinish: () => void;
};

const STEPS = [
  { title: "Sign in", subtitle: "Continue with Google" },
  { title: "Welcome", subtitle: "Browser automation" },
  { title: "Connect AI", subtitle: "Add provider key" },
  { title: "Pick model", subtitle: "Choose default" },
  { title: "Your agent", subtitle: "Name & avatar" },
  { title: "Ready", subtitle: "Finish setup" },
];

function configuredProvider(providers: MindflyProviderStatus[], id: string): boolean {
  return providers.some((p) => p.id === id && p.configured);
}

export function renderMindflyOnboarding(props: MindflyOnboardingProps) {
  const step = Math.max(0, Math.min(STEPS.length - 1, props.step));
  const canBack = step > 0 && !props.finishing;
  const nextLabel = step === STEPS.length - 1 ? "Finish" : "Next";

  const canNext = (() => {
    if (!props.connected) return false;
    if (props.finishing) return false;
    switch (step) {
      case 0:
        return Boolean(props.identity);
      case 1:
        return true;
      case 2:
        return configuredProvider(props.providers, props.provider);
      case 3:
        return Boolean(props.model.trim());
      case 4:
        return Boolean(props.assistantName.trim());
      case 5:
        return true;
      default:
        return false;
    }
  })();

  const onBack = () => props.setStep(Math.max(0, step - 1));
  const onNext = () => {
    if (!canNext) return;
    if (step === 2 && props.models.length === 0 && !props.modelsLoading) {
      props.onModelsLoad();
    }
    if (step === STEPS.length - 1) {
      props.onFinish();
      return;
    }
    props.setStep(Math.min(STEPS.length - 1, step + 1));
  };

  const stepper = html`
    <div class="onboard-stepper">
      ${STEPS.map((s, idx) => {
        const state = idx === step ? "active" : idx < step ? "done" : "todo";
        return html`
          <button
            class="onboard-step onboard-step--${state}"
            ?disabled=${idx > step}
            @click=${() => props.setStep(idx)}
            title=${s.title}
          >
            <span class="onboard-dot"></span>
            <span class="onboard-step-label">${s.title}</span>
          </button>
        `;
      })}
    </div>
  `;

  const content = (() => {
    if (!props.connected) {
      return html`
        <div class="card">
          <div class="card-title">Connect to continue</div>
          <div class="card-sub">Mindfly onboarding needs a live connection to the gateway.</div>
          <div class="callout warn" style="margin-top: 14px;">
            Open a tokenized dashboard URL, or paste the token in the gateway dashboard settings,
            then click Connect.
          </div>
        </div>
      `;
    }

    if (step === 0) {
      return html`
        <div class="card onboard-card">
          <div class="card-title">Sign in with Google</div>
          <div class="card-sub">
            This is your Mindfly identity. Provider authentication is configured in the next steps.
          </div>

          <div style="margin-top: 16px;">
            ${props.identityLoading
              ? html`<div class="callout">Loading…</div>`
              : props.identity
                ? html`
                    <div class="callout">
                      Signed in as <span class="mono">${props.identity.email}</span>.
                    </div>
                  `
                : html`
                    <button class="btn primary" ?disabled=${props.authBusy} @click=${props.onGoogleSignIn}>
                      Continue with Google
                    </button>
                    <div class="muted" style="margin-top: 10px;">
                      Tokens are stored in the OS secure store (Keychain / Credential Manager).
                    </div>
                  `}

            ${props.identityError
              ? html`<div class="callout danger" style="margin-top: 12px;">${props.identityError}</div>`
              : nothing}
          </div>
        </div>
      `;
    }

    if (step === 1) {
      return html`
        <div class="card onboard-card">
          <div class="card-title">Welcome to Mindfly</div>
          <div class="card-sub">Let’s turn on browser automation and keep it safe by default.</div>
          <div style="margin-top: 16px;">
            <label class="toggle-row">
              <input
                type="checkbox"
                .checked=${props.browserEnabled}
                @change=${(e: Event) => props.setBrowserEnabled((e.target as HTMLInputElement).checked)}
              />
              <div>
                <div class="toggle-title">Enable browser automation</div>
                <div class="toggle-sub">Mindfly can browse and automate the browser with approvals.</div>
              </div>
            </label>
            <div class="callout" style="margin-top: 12px;">
              Safety note: screenshots and page content are treated as untrusted external input.
            </div>
          </div>
        </div>
      `;
    }

    if (step === 2) {
      const providerOptions = props.providers.map(
        (p) => html`<option value=${p.id} ?selected=${p.id === props.provider}>${p.label}</option>`,
      );
      const configured = configuredProvider(props.providers, props.provider);
      return html`
        <div class="card onboard-card">
          <div class="card-title">Connect your AI provider</div>
          <div class="card-sub">Add an API key. It’s encrypted and stored in the OS secure store.</div>
          <div style="margin-top: 16px;">
            ${props.providersLoading
              ? html`<div class="callout">Loading providers…</div>`
              : html`
                  <div class="form-grid">
                    <label class="field">
                      <span>Provider</span>
                      <select
                        .value=${props.provider}
                        @change=${(e: Event) => props.setProvider((e.target as HTMLSelectElement).value)}
                      >
                        ${providerOptions}
                      </select>
                    </label>
                    <label class="field">
                      <span>API key</span>
                      <input
                        type="password"
                        .value=${props.apiKey}
                        @input=${(e: Event) => props.setApiKey((e.target as HTMLInputElement).value)}
                        placeholder="Paste your API key"
                        autocomplete="off"
                      />
                    </label>
                  </div>
                  <div class="row" style="margin-top: 12px;">
                    <button
                      class="btn primary"
                      ?disabled=${props.apiKey.trim().length === 0}
                      @click=${() => props.onApiKeySave(props.provider, props.apiKey)}
                    >
                      Save key
                    </button>
                    <button class="btn" @click=${props.onProvidersRefresh}>Refresh</button>
                    ${configured ? html`<span class="pill">Connected</span>` : html`<span class="pill danger">Not connected</span>`}
                  </div>
                  ${props.providersError
                    ? html`<div class="callout danger" style="margin-top: 12px;">${props.providersError}</div>`
                    : nothing}
                `}
          </div>
        </div>
      `;
    }

    if (step === 3) {
      const models = props.models.filter((m) => m.provider === props.provider);
      const options = models.map(
        (m) => html`<option value=${m.id} ?selected=${m.id === props.model}>${m.name}</option>`,
      );
      return html`
        <div class="card onboard-card">
          <div class="card-title">Pick your default model</div>
          <div class="card-sub">You can change this later in Settings.</div>
          <div style="margin-top: 16px;">
            ${props.modelsLoading
              ? html`<div class="callout">Loading models…</div>`
              : models.length
                ? html`
                    <label class="field">
                      <span>Model</span>
                      <select
                        .value=${props.model}
                        @change=${(e: Event) => props.setModel((e.target as HTMLSelectElement).value)}
                      >
                        <option value="">Select a model…</option>
                        ${options}
                      </select>
                    </label>
                    <div class="row" style="margin-top: 12px;">
                      <button class="btn" @click=${props.onModelsLoad}>Reload</button>
                      <span class="muted">${models.length} models for <span class="mono">${props.provider}</span></span>
                    </div>
                  `
                : html`
                    <div class="callout warn">
                      No models found for <span class="mono">${props.provider}</span>.
                    </div>
                    <div class="row" style="margin-top: 12px;">
                      <button class="btn primary" @click=${props.onModelsLoad}>Load models</button>
                    </div>
                  `}
            ${props.modelsError
              ? html`<div class="callout danger" style="margin-top: 12px;">${props.modelsError}</div>`
              : nothing}
          </div>
        </div>
      `;
    }

    if (step === 4) {
      return html`
        <div class="card onboard-card">
          <div class="card-title">Meet your agent</div>
          <div class="card-sub">Give your assistant a name and an avatar.</div>
          <div style="margin-top: 16px;">
            <div class="form-grid">
              <label class="field">
                <span>Name</span>
                <input
                  .value=${props.assistantName}
                  @input=${(e: Event) => props.setAssistantName((e.target as HTMLInputElement).value)}
                  placeholder="Assistant"
                />
              </label>
              <label class="field">
                <span>Avatar</span>
                <input
                  .value=${props.assistantAvatar}
                  @input=${(e: Event) => props.setAssistantAvatar((e.target as HTMLInputElement).value)}
                  placeholder="🦋"
                />
              </label>
            </div>
            <div class="callout" style="margin-top: 12px;">
              Preview: <span class="pill">${props.assistantAvatar.trim() || "🦋"}</span>
              <span class="muted"> ${props.assistantName.trim() || "Assistant"}</span>
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="card onboard-card">
        <div class="card-title">Ready to fly</div>
        <div class="card-sub">Review your setup and finish.</div>
        <div style="margin-top: 16px;">
          <div class="status-list">
            <div><span>Google</span><span class="mono">${props.identity?.email ?? "—"}</span></div>
            <div><span>Provider</span><span class="mono">${props.provider}</span></div>
            <div><span>Model</span><span class="mono">${props.model || "—"}</span></div>
            <div><span>Browser automation</span><span>${props.browserEnabled ? "Enabled" : "Off"}</span></div>
          </div>
          ${props.finishing
            ? html`<div class="callout" style="margin-top: 12px;">Applying settings… gateway will restart.</div>`
            : nothing}
        </div>
      </div>
    `;
  })();

  return html`
    <div class="onboard">
      <div class="onboard-header">
        <div class="onboard-brand">
          <div class="onboard-logo">🦋</div>
          <div>
            <div class="onboard-title">Mindfly</div>
            <div class="onboard-sub">First-time setup</div>
          </div>
        </div>
        <div class="onboard-progress">
          Step <span class="mono">${step + 1}</span> of <span class="mono">${STEPS.length}</span>
        </div>
      </div>

      ${stepper}

      ${content}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      <div class="onboard-actions">
        <button class="btn" ?disabled=${!canBack} @click=${onBack}>Back</button>
        <div style="flex: 1;"></div>
        <button class="btn primary" ?disabled=${!canNext} @click=${onNext}>${nextLabel}</button>
      </div>
    </div>
  `;
}

