import { decryptFromStorage, encryptForStorage } from "../../security/storage-crypto.js";
import { resolveInstallUuid } from "../../security/install-uuid.js";
import { readSecureStoreSecret, writeSecureStoreSecret } from "../../infra/secure-store.js";
import { isMindflyBrand } from "../../infra/brand.js";

import type { AuthProfileCredential, AuthProfileStore } from "./types.js";
import type { SecureStoreDecision } from "../../infra/secure-store.js";

export const AUTH_PROFILE_SECURE_REF_PREFIX = "secure:";
export const AUTH_PROFILE_SECURE_STORE_SERVICE = "ai.openclaw.auth-profiles";

export type AuthProfileSecureStoreClient = {
  read: (account: string) => SecureStoreDecision;
  write: (account: string, secret: string) => { ok: true } | { ok: false; error: string };
};

function createDefaultClient(): AuthProfileSecureStoreClient {
  return {
    read: (account) =>
      readSecureStoreSecret({ service: AUTH_PROFILE_SECURE_STORE_SERVICE, account }),
    write: (account, secret) =>
      writeSecureStoreSecret({ service: AUTH_PROFILE_SECURE_STORE_SERVICE, account, secret }),
  };
}

const DEFAULT_CLIENT = createDefaultClient();

export function isAuthProfileSecureStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_AUTH_SECURE_STORE === "1" || isMindflyBrand(env);
}

export function isSecureStoreRef(value: string): boolean {
  return value.startsWith(AUTH_PROFILE_SECURE_REF_PREFIX);
}

export function parseSecureStoreRef(value: string): string | null {
  if (!isSecureStoreRef(value)) {
    return null;
  }
  const account = value.slice(AUTH_PROFILE_SECURE_REF_PREFIX.length).trim();
  return account ? account : null;
}

export function formatSecureStoreRef(account: string): string {
  return `${AUTH_PROFILE_SECURE_REF_PREFIX}${account}`;
}

function resolveSecretFromDecision(decision: SecureStoreDecision, ref: string): string {
  if (!decision.ok) {
    throw new Error(`secure-store failed (${decision.error}) for ${ref}`);
  }
  return decision.secret;
}

export function resolveAuthProfileSecret(
  value: string,
  client: AuthProfileSecureStoreClient = DEFAULT_CLIENT,
): string {
  const account = parseSecureStoreRef(value);
  if (!account) {
    return value;
  }
  const installUuid = resolveInstallUuid();
  const decision = client.read(account);
  const ciphertext = resolveSecretFromDecision(decision, value);
  return decryptFromStorage(ciphertext, installUuid);
}

export function storeAuthProfileSecret(
  params: { account: string; secret: string },
  client: AuthProfileSecureStoreClient = DEFAULT_CLIENT,
): string {
  const installUuid = resolveInstallUuid();
  const ciphertext = encryptForStorage(params.secret, installUuid);
  const result = client.write(params.account, ciphertext);
  if (!result.ok) {
    throw new Error(`secure-store write failed (${result.error}) for ${params.account}`);
  }
  return formatSecureStoreRef(params.account);
}

function buildSecretAccount(profileId: string, kind: string): string {
  return `auth-profile:${profileId}:${kind}`;
}

export function migrateAuthProfileCredentialToSecureStore(params: {
  profileId: string;
  credential: AuthProfileCredential;
  client?: AuthProfileSecureStoreClient;
}): { credential: AuthProfileCredential; migrated: boolean } {
  const { profileId } = params;
  const cred = params.credential;
  const client = params.client ?? DEFAULT_CLIENT;

  if (cred.type === "api_key") {
    const keyRaw = cred.key?.trim();
    if (!keyRaw || isSecureStoreRef(keyRaw)) {
      return { credential: cred, migrated: false };
    }
    const account = buildSecretAccount(profileId, "api-key");
    const ref = storeAuthProfileSecret({ account, secret: keyRaw }, client);
    return { credential: { ...cred, key: ref }, migrated: true };
  }

  if (cred.type === "token") {
    const tokenRaw = cred.token?.trim();
    if (!tokenRaw || isSecureStoreRef(tokenRaw)) {
      return { credential: cred, migrated: false };
    }
    const account = buildSecretAccount(profileId, "token");
    const ref = storeAuthProfileSecret({ account, secret: tokenRaw }, client);
    return { credential: { ...cred, token: ref }, migrated: true };
  }

  const accessRaw = cred.access?.trim();
  const refreshRaw = cred.refresh?.trim();

  let migrated = false;
  let access = cred.access;
  let refresh = cred.refresh;

  if (accessRaw && !isSecureStoreRef(accessRaw)) {
    const account = buildSecretAccount(profileId, "oauth-access");
    access = storeAuthProfileSecret({ account, secret: accessRaw }, client);
    migrated = true;
  }
  if (refreshRaw && !isSecureStoreRef(refreshRaw)) {
    const account = buildSecretAccount(profileId, "oauth-refresh");
    refresh = storeAuthProfileSecret({ account, secret: refreshRaw }, client);
    migrated = true;
  }

  if (!migrated) {
    return { credential: cred, migrated: false };
  }

  return {
    credential: {
      ...cred,
      access,
      refresh,
    },
    migrated: true,
  };
}

export function migrateAuthProfileStoreToSecureStore(
  store: AuthProfileStore,
  client: AuthProfileSecureStoreClient = DEFAULT_CLIENT,
): boolean {
  if (!isAuthProfileSecureStoreEnabled()) {
    return false;
  }

  let mutated = false;
  for (const [profileId, cred] of Object.entries(store.profiles)) {
    const result = migrateAuthProfileCredentialToSecureStore({
      profileId,
      credential: cred,
      client,
    });
    if (result.migrated) {
      store.profiles[profileId] = result.credential;
      mutated = true;
    }
  }
  return mutated;
}
