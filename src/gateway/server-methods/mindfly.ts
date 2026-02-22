import { isMindflyBrand } from "../../infra/brand.js";
import { normalizeProviderId } from "../../agents/model-selection.js";
import {
  updateAuthProfileStoreWithLock,
  ensureAuthProfileStore,
} from "../../agents/auth-profiles/store.js";
import type { AuthProfileCredential } from "../../agents/auth-profiles/types.js";
import {
  AUTH_PROFILE_SECURE_STORE_SERVICE,
  parseSecureStoreRef,
} from "../../agents/auth-profiles/secure-store.js";
import { deleteSecureStoreSecret } from "../../infra/secure-store.js";
import { getGoogleIdentityService } from "../google-identity.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateMindflyGoogleIdentityGetParams,
  validateMindflyGoogleSignInStartParams,
  validateMindflyGoogleSignInWaitParams,
  validateMindflyGoogleSignOutParams,
  validateMindflyIntegrationsProvidersListParams,
  validateMindflyIntegrationsProviderSetApiKeyParams,
  validateMindflyIntegrationsProviderClearApiKeyParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

function assertMindflyEnabled() {
  if (!isMindflyBrand(process.env)) {
    throw new Error("mindfly mode not enabled");
  }
}

const MINDFLY_AI_PROVIDERS: Array<{ id: string; label: string }> = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google Gemini" },
  { id: "openrouter", label: "OpenRouter" },
];

function isConfiguredCredential(cred: AuthProfileCredential | undefined): boolean {
  if (!cred) {
    return false;
  }
  if (cred.type === "api_key") {
    return Boolean(cred.key?.trim());
  }
  if (cred.type === "token") {
    return Boolean(cred.token?.trim());
  }
  return Boolean(cred.access?.trim() && cred.refresh?.trim());
}

export const mindflyHandlers: GatewayRequestHandlers = {
  "mindfly.google.identity.get": async ({ params, respond }) => {
    if (!validateMindflyGoogleIdentityGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.google.identity.get params: ${formatValidationErrors(
            validateMindflyGoogleIdentityGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      const identity = await getGoogleIdentityService().getIdentity();
      respond(true, { identity }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "mindfly.google.signin.start": async ({ params, respond }) => {
    if (!validateMindflyGoogleSignInStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.google.signin.start params: ${formatValidationErrors(
            validateMindflyGoogleSignInStartParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      const result = await getGoogleIdentityService().startSignIn();
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "mindfly.google.signin.wait": async ({ params, respond }) => {
    if (!validateMindflyGoogleSignInWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.google.signin.wait params: ${formatValidationErrors(
            validateMindflyGoogleSignInWaitParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      const p = params as { sessionId: string; timeoutMs?: number };
      const identity = await getGoogleIdentityService().waitSignIn(p.sessionId, p.timeoutMs);
      respond(true, { identity }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "mindfly.google.signout": async ({ params, respond }) => {
    if (!validateMindflyGoogleSignOutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.google.signout params: ${formatValidationErrors(
            validateMindflyGoogleSignOutParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      await getGoogleIdentityService().signOut();
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "mindfly.integrations.providers.list": async ({ params, respond }) => {
    if (!validateMindflyIntegrationsProvidersListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.integrations.providers.list params: ${formatValidationErrors(
            validateMindflyIntegrationsProvidersListParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      const store = ensureAuthProfileStore();
      const providers = MINDFLY_AI_PROVIDERS.map((entry) => {
        const id = normalizeProviderId(entry.id);
        const profileId = `${id}:default`;
        const configured = isConfiguredCredential(store.profiles[profileId]);
        return { id, label: entry.label, configured };
      });
      respond(true, { providers }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "mindfly.integrations.provider.apiKey.set": async ({ params, respond }) => {
    if (!validateMindflyIntegrationsProviderSetApiKeyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.integrations.provider.apiKey.set params: ${formatValidationErrors(
            validateMindflyIntegrationsProviderSetApiKeyParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      const p = params as { provider: string; apiKey: string };
      const provider = normalizeProviderId(p.provider);
      const apiKey = p.apiKey.trim();
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "apiKey is required"));
        return;
      }
      const known = MINDFLY_AI_PROVIDERS.some(
        (entry) => normalizeProviderId(entry.id) === provider,
      );
      if (!known) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider: ${provider}`),
        );
        return;
      }
      const profileId = `${provider}:default`;
      const updated = await updateAuthProfileStoreWithLock({
        updater: (store) => {
          store.profiles[profileId] = {
            type: "api_key",
            provider,
            key: apiKey,
          };
          return true;
        },
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "failed to update auth profile store"),
        );
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "mindfly.integrations.provider.apiKey.clear": async ({ params, respond }) => {
    if (!validateMindflyIntegrationsProviderClearApiKeyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mindfly.integrations.provider.apiKey.clear params: ${formatValidationErrors(
            validateMindflyIntegrationsProviderClearApiKeyParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      assertMindflyEnabled();
      const p = params as { provider: string };
      const provider = normalizeProviderId(p.provider);
      const known = MINDFLY_AI_PROVIDERS.some(
        (entry) => normalizeProviderId(entry.id) === provider,
      );
      if (!known) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider: ${provider}`),
        );
        return;
      }
      const profileId = `${provider}:default`;
      let accountToDelete: string | null = null;
      await updateAuthProfileStoreWithLock({
        updater: (store) => {
          const cred = store.profiles[profileId];
          if (cred?.type === "api_key") {
            accountToDelete = parseSecureStoreRef(cred.key) ?? `auth-profile:${profileId}:api-key`;
          }
          if (!cred) {
            return false;
          }
          delete store.profiles[profileId];
          return true;
        },
      });
      if (accountToDelete) {
        deleteSecureStoreSecret({
          service: AUTH_PROFILE_SECURE_STORE_SERVICE,
          account: accountToDelete,
        });
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
