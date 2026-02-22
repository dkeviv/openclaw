import { randomUUID } from "node:crypto";

import { readSecureStoreSecret, writeSecureStoreSecret } from "../infra/secure-store.js";
import type { SecureStoreDecision } from "../infra/secure-store.js";
import { resolveInstallUuid } from "../security/install-uuid.js";
import { decryptFromStorage, encryptForStorage } from "../security/storage-crypto.js";

export const MINDFLY_SECURE_STORE_SERVICE = "mindfly";
export const MINDFLY_GATEWAY_TOKEN_ACCOUNT = "gateway-token";

export type MindflySecureStoreClient = {
  read: (account: string) => SecureStoreDecision;
  write: (account: string, secret: string) => { ok: true } | { ok: false; error: string };
};

function createDefaultClient(): MindflySecureStoreClient {
  return {
    read: (account) => readSecureStoreSecret({ service: MINDFLY_SECURE_STORE_SERVICE, account }),
    write: (account, secret) =>
      writeSecureStoreSecret({ service: MINDFLY_SECURE_STORE_SERVICE, account, secret }),
  };
}

const DEFAULT_CLIENT = createDefaultClient();

function readDecryptedGatewayToken(client: MindflySecureStoreClient, installUuid: string): string {
  const decision = client.read(MINDFLY_GATEWAY_TOKEN_ACCOUNT);
  if (!decision.ok) {
    return "";
  }
  try {
    return decryptFromStorage(decision.secret, installUuid).trim();
  } catch {
    return "";
  }
}

export function resolveMindflyGatewayToken(
  client: MindflySecureStoreClient = DEFAULT_CLIENT,
): string {
  const installUuid = resolveInstallUuid();
  const existing = readDecryptedGatewayToken(client, installUuid);
  if (existing) {
    return existing;
  }

  const token = randomUUID();
  const encrypted = encryptForStorage(token, installUuid);
  const stored = client.write(MINDFLY_GATEWAY_TOKEN_ACCOUNT, encrypted);
  if (!stored.ok) {
    throw new Error(`failed to store mindfly gateway token (${stored.error})`);
  }
  return token;
}
