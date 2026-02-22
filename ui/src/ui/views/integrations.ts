import { html, nothing } from "lit";

export type MindflyProviderStatus = { id: string; label: string; configured: boolean };

export type IntegrationsProps = {
  brand: "openclaw" | "mindfly";
  connected: boolean;
  identity: {
    email: string;
    name?: string;
    picture?: string;
  } | null;
  identityLoading: boolean;
  identityError: string | null;
  authBusy: boolean;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
  onGoogleRefresh: () => void;
  providers: MindflyProviderStatus[];
  providersLoading: boolean;
  providersError: string | null;
  apiKeyProvider: string;
  apiKey: string;
  apiKeySaving: boolean;
  apiKeyError: string | null;
  onApiKeyProviderChange: (next: string) => void;
  onApiKeyChange: (next: string) => void;
  onApiKeySave: () => void;
  onApiKeyClear: (provider: string) => void;
};

function initials(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return "U";
  const parts = trimmed.split("@")[0] ?? trimmed;
  const letters = parts.replace(/[^a-z0-9]/gi, "");
  return (letters.slice(0, 2) || "U").toUpperCase();
}

export function renderIntegrations(props: IntegrationsProps) {
  if (props.brand !== "mindfly") {
    return html`
      <section class="grid grid-cols-2">
        <div class="card">
          <div class="card-title">Mindfly Integrations</div>
          <div class="card-sub">
            This surface is available when the gateway runs in Mindfly mode.
          </div>
          <div class="callout" style="margin-top: 14px;">
            Set <span class="mono">OPENCLAW_BRAND=mindfly</span> when starting the gateway.
          </div>
        </div>
      </section>
    `;
  }

  const identityCard = (() => {
    if (!props.connected) {
      return html`<div class="callout warn">Connect to the gateway to manage sign-in.</div>`;
    }
    if (props.identityLoading) {
      return html`<div class="callout">Loading…</div>`;
    }
    if (props.identity) {
      const avatar = props.identity.picture
        ? html`<img
            src=${props.identity.picture}
            alt="Google profile"
            style="width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--border);"
          />`
        : html`<div
            style="width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--bg-elevated); font-weight: 700;"
          >
            ${initials(props.identity.email)}
          </div>`;
      return html`
        <div style="display: flex; align-items: center; gap: 12px;">
          ${avatar}
          <div style="min-width: 0;">
            <div style="font-weight: 600; color: var(--text-strong);">
              ${props.identity.name ?? "Signed in"}
            </div>
            <div class="muted" style="font-size: 13px;">${props.identity.email}</div>
          </div>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" ?disabled=${props.authBusy} @click=${props.onGoogleRefresh}>
            Refresh
          </button>
          <button class="btn danger" ?disabled=${props.authBusy} @click=${props.onGoogleSignOut}>
            Sign out
          </button>
          <span class="muted">Tokens are stored in the OS secure store.</span>
        </div>
      `;
    }
    return html`
      <div class="callout">
        Google sign-in is required for Mindfly.
        <div class="muted" style="margin-top: 6px;">
          This identity is separate from AI provider authentication.
        </div>
      </div>
      <div class="row" style="margin-top: 14px;">
        <button class="btn primary" ?disabled=${props.authBusy} @click=${props.onGoogleSignIn}>
          Continue with Google
        </button>
      </div>
    `;
  })();

  const providersCard = (() => {
    if (!props.connected) {
      return html`<div class="callout warn">Connect to the gateway to manage provider keys.</div>`;
    }
    if (props.providersLoading) {
      return html`<div class="callout">Loading…</div>`;
    }
    const providerRows = props.providers.length
      ? html`
          <div class="status-list" style="margin-top: 10px;">
            ${props.providers.map((p) => {
              const status = p.configured ? "Connected" : "Not connected";
              return html`
                <div>
                  <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-weight: 600; color: var(--text-strong);">${p.label}</span>
                    <span class="muted" style="font-size: 12px;">${p.id}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="pill ${p.configured ? "" : "danger"}">${status}</span>
                    ${p.configured
                      ? html`
                          <button
                            class="btn"
                            ?disabled=${props.apiKeySaving}
                            @click=${() => props.onApiKeyClear(p.id)}
                          >
                            Remove
                          </button>
                        `
                      : nothing}
                  </div>
                </div>
              `;
            })}
          </div>
        `
      : html`<div class="callout">No providers available.</div>`;

    const providerOptions = props.providers.map(
      (p) => html`<option value=${p.id} ?selected=${p.id === props.apiKeyProvider}>${p.label}</option>`,
    );

    return html`
      ${providerRows}
      <div style="margin-top: 16px;">
        <div class="card-sub">Add an API key (stored securely; never written to config).</div>
        <div class="form-grid" style="margin-top: 12px;">
          <label class="field">
            <span>Provider</span>
            <select
              .value=${props.apiKeyProvider}
              @change=${(e: Event) => props.onApiKeyProviderChange((e.target as HTMLSelectElement).value)}
            >
              ${providerOptions}
            </select>
          </label>
          <label class="field">
            <span>API key</span>
            <input
              type="password"
              .value=${props.apiKey}
              @input=${(e: Event) => props.onApiKeyChange((e.target as HTMLInputElement).value)}
              placeholder="Paste your API key"
              autocomplete="off"
            />
          </label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" ?disabled=${props.apiKeySaving} @click=${props.onApiKeySave}>
            Save key
          </button>
          ${props.apiKeyError ? html`<span class="muted" style="color: var(--danger);">${props.apiKeyError}</span>` : nothing}
        </div>
      </div>
    `;
  })();

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Google Account</div>
        <div class="card-sub">Identity and session management.</div>
        <div style="margin-top: 14px;">${identityCard}</div>
        ${props.identityError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.identityError}</div>`
          : nothing}
      </div>
      <div class="card">
        <div class="card-title">AI Providers</div>
        <div class="card-sub">Connect the model provider you want Mindfly to use.</div>
        <div style="margin-top: 14px;">${providersCard}</div>
        ${props.providersError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.providersError}</div>`
          : nothing}
      </div>
    </section>
  `;
}

