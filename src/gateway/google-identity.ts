import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { isMindflyBrand } from "../infra/brand.js";
import {
  deleteSecureStoreSecret,
  readSecureStoreSecret,
  writeSecureStoreSecret,
} from "../infra/secure-store.js";
import type { SecureStoreDecision } from "../infra/secure-store.js";
import { resolveInstallUuid } from "../security/install-uuid.js";
import { decryptFromStorage, encryptForStorage } from "../security/storage-crypto.js";

export type GoogleIdentityRecord = {
  email: string;
  name?: string;
  picture?: string;
  id?: string;
  expiresAtMs: number;
};

export type GoogleSignInStartResult = {
  sessionId: string;
  authUrl: string;
};

type GoogleSecureStoreClient = {
  read: (account: string) => SecureStoreDecision;
  write: (account: string, secret: string) => { ok: true } | { ok: false; error: string };
  delete: (account: string) => { ok: true } | { ok: false; error: string };
};

type GoogleIdentityServiceDeps = {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  now: () => number;
  secureStore: GoogleSecureStoreClient;
  redirectPort: number;
};

type PendingGoogleSignIn = {
  sessionId: string;
  state: string;
  verifier: string;
  server: http.Server;
  resolve: (identity: GoogleIdentityRecord) => void;
  reject: (err: Error) => void;
  promise: Promise<GoogleIdentityRecord>;
};

const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

const MINDFLY_SECURE_STORE_SERVICE = "mindfly";
const GOOGLE_ACCESS_ACCOUNT = "google-access-token";
const GOOGLE_REFRESH_ACCOUNT = "google-refresh-token";
const GOOGLE_IDENTITY_ACCOUNT = "google-identity";

const GOOGLE_SCOPES = ["openid", "email", "profile"];
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256Base64Url(value: string): string {
  const hash = createHash("sha256").update(value).digest();
  return base64UrlEncode(hash);
}

function parseSecureStoreSecret(decision: SecureStoreDecision): string | null {
  if (!decision.ok) {
    return null;
  }
  const secret = decision.secret?.trim();
  return secret ? secret : null;
}

function resolveGoogleClientId(env: NodeJS.ProcessEnv): string {
  const raw =
    env.MINDFLY_GOOGLE_CLIENT_ID ??
    env.OPENCLAW_GOOGLE_CLIENT_ID ??
    env.GOOGLE_OAUTH_CLIENT_ID ??
    "";
  return raw.trim();
}

function createDefaultSecureStore(): GoogleSecureStoreClient {
  return {
    read: (account) => readSecureStoreSecret({ service: MINDFLY_SECURE_STORE_SERVICE, account }),
    write: (account, secret) =>
      writeSecureStoreSecret({ service: MINDFLY_SECURE_STORE_SERVICE, account, secret }),
    delete: (account) =>
      deleteSecureStoreSecret({ service: MINDFLY_SECURE_STORE_SERVICE, account }),
  };
}

async function readIdentityRecord(
  store: GoogleSecureStoreClient,
): Promise<GoogleIdentityRecord | null> {
  const decision = store.read(GOOGLE_IDENTITY_ACCOUNT);
  const raw = parseSecureStoreSecret(decision);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleIdentityRecord>;
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const expiresAtMs =
      typeof parsed.expiresAtMs === "number" && Number.isFinite(parsed.expiresAtMs)
        ? parsed.expiresAtMs
        : 0;
    if (!email || expiresAtMs <= 0) {
      return null;
    }
    const name =
      typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined;
    const picture =
      typeof parsed.picture === "string" && parsed.picture.trim()
        ? parsed.picture.trim()
        : undefined;
    const id = typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined;
    return {
      email,
      expiresAtMs,
      ...(name ? { name } : {}),
      ...(picture ? { picture } : {}),
      ...(id ? { id } : {}),
    };
  } catch {
    return null;
  }
}

function writeIdentityRecord(store: GoogleSecureStoreClient, record: GoogleIdentityRecord): void {
  const result = store.write(GOOGLE_IDENTITY_ACCOUNT, JSON.stringify(record));
  if (!result.ok) {
    throw new Error(`secure-store write failed (${result.error}) for ${GOOGLE_IDENTITY_ACCOUNT}`);
  }
}

function readEncryptedToken(store: GoogleSecureStoreClient, account: string): string | null {
  const decision = store.read(account);
  const ciphertext = parseSecureStoreSecret(decision);
  if (!ciphertext) {
    return null;
  }
  const installUuid = resolveInstallUuid();
  try {
    const decrypted = decryptFromStorage(ciphertext, installUuid).trim();
    return decrypted ? decrypted : null;
  } catch {
    return null;
  }
}

function writeEncryptedToken(store: GoogleSecureStoreClient, account: string, token: string): void {
  const installUuid = resolveInstallUuid();
  const ciphertext = encryptForStorage(token, installUuid);
  const result = store.write(account, ciphertext);
  if (!result.ok) {
    throw new Error(`secure-store write failed (${result.error}) for ${account}`);
  }
}

async function exchangeAuthCode(params: {
  fetch: typeof fetch;
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresAtMs: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
  });
  const res = await params.fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google token exchange failed (${res.status}): ${text}`);
  }
  const parsed = JSON.parse(text) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token.trim() : "";
  const refreshToken =
    typeof parsed.refresh_token === "string" && parsed.refresh_token.trim()
      ? parsed.refresh_token.trim()
      : null;
  const expiresIn =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : 0;
  if (!accessToken || expiresIn <= 0) {
    throw new Error("google token exchange returned an invalid access_token");
  }
  const expiresAtMs = Date.now() + Math.max(0, expiresIn * 1000 - REFRESH_SKEW_MS);
  return { accessToken, refreshToken, expiresAtMs };
}

async function refreshAccessToken(params: {
  fetch: typeof fetch;
  clientId: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresAtMs: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });
  const res = await params.fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google token refresh failed (${res.status}): ${text}`);
  }
  const parsed = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token.trim() : "";
  const expiresIn =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : 0;
  if (!accessToken || expiresIn <= 0) {
    throw new Error("google token refresh returned an invalid access_token");
  }
  const expiresAtMs = Date.now() + Math.max(0, expiresIn * 1000 - REFRESH_SKEW_MS);
  return { accessToken, expiresAtMs };
}

async function fetchUserInfo(params: { fetch: typeof fetch; accessToken: string }): Promise<{
  email: string;
  name?: string;
  picture?: string;
  id?: string;
}> {
  const res = await params.fetch(GOOGLE_USERINFO_URL, {
    method: "GET",
    headers: { authorization: `Bearer ${params.accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google userinfo failed (${res.status}): ${text}`);
  }
  const parsed = JSON.parse(text) as {
    email?: unknown;
    name?: unknown;
    picture?: unknown;
    id?: unknown;
  };
  const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
  if (!email) {
    throw new Error("google userinfo did not include an email");
  }
  const name =
    typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined;
  const picture =
    typeof parsed.picture === "string" && parsed.picture.trim() ? parsed.picture.trim() : undefined;
  const id = typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined;
  return {
    email,
    ...(name ? { name } : {}),
    ...(picture ? { picture } : {}),
    ...(id ? { id } : {}),
  };
}

function respondCallback(res: http.ServerResponse, params: { ok: boolean; message: string }) {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mindfly sign-in</title>
  </head>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px;">
    <h2 style="margin: 0 0 12px 0;">${params.ok ? "Sign-in complete" : "Sign-in failed"}</h2>
    <p style="margin: 0; color: #444;">${params.message}</p>
    <p style="margin: 12px 0 0 0; color: #666; font-size: 14px;">You can close this tab and return to Mindfly.</p>
  </body>
</html>`;
  res.statusCode = params.ok ? 200 : 400;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(GOOGLE_OAUTH_AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export class GoogleIdentityService {
  private pending = new Map<string, PendingGoogleSignIn>();
  constructor(private deps: GoogleIdentityServiceDeps) {}

  private closeSession(sessionId: string) {
    const entry = this.pending.get(sessionId);
    if (!entry) {
      return;
    }
    this.pending.delete(sessionId);
    try {
      entry.server.close();
    } catch {
      // ignore
    }
  }

  async getIdentity(): Promise<GoogleIdentityRecord | null> {
    if (!isMindflyBrand(this.deps.env)) {
      return null;
    }
    const identity = await readIdentityRecord(this.deps.secureStore);
    if (!identity) {
      return null;
    }
    const refreshAtMs = identity.expiresAtMs - REFRESH_SKEW_MS;
    if (this.deps.now() < refreshAtMs) {
      return identity;
    }
    const clientId = resolveGoogleClientId(this.deps.env);
    if (!clientId) {
      return identity;
    }
    const refreshToken = readEncryptedToken(this.deps.secureStore, GOOGLE_REFRESH_ACCOUNT);
    if (!refreshToken) {
      await this.signOut();
      return null;
    }
    try {
      const refreshed = await refreshAccessToken({
        fetch: this.deps.fetch,
        clientId,
        refreshToken,
      });
      writeEncryptedToken(this.deps.secureStore, GOOGLE_ACCESS_ACCOUNT, refreshed.accessToken);
      const next: GoogleIdentityRecord = { ...identity, expiresAtMs: refreshed.expiresAtMs };
      writeIdentityRecord(this.deps.secureStore, next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid_grant")) {
        await this.signOut();
        return null;
      }
      return identity;
    }
  }

  async startSignIn(): Promise<GoogleSignInStartResult> {
    if (!isMindflyBrand(this.deps.env)) {
      throw new Error("mindfly sign-in is not enabled");
    }
    const clientId = resolveGoogleClientId(this.deps.env);
    if (!clientId) {
      throw new Error("google oauth client id is not configured (set MINDFLY_GOOGLE_CLIENT_ID)");
    }
    if (this.pending.size > 0) {
      throw new Error("google sign-in already running");
    }

    const sessionId = randomUUID();
    const verifier = base64UrlEncode(randomBytes(32));
    const state = base64UrlEncode(randomBytes(16));
    const challenge = sha256Base64Url(verifier);

    let resolveFn!: (identity: GoogleIdentityRecord) => void;
    let rejectFn!: (err: Error) => void;
    const promise = new Promise<GoogleIdentityRecord>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const server = http.createServer(async (req, res) => {
      const complete = (params: { ok: boolean; message: string; error?: Error }) => {
        respondCallback(res, { ok: params.ok, message: params.message });
        if (params.error) {
          rejectFn(params.error);
        }
        if (!params.ok) {
          // ensure waiters resolve quickly
          this.closeSession(sessionId);
        }
      };
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const returnedState = url.searchParams.get("state") ?? "";
      if (!returnedState || returnedState !== state) {
        respondCallback(res, { ok: false, message: "Invalid callback state." });
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        complete({
          ok: false,
          message: `OAuth error: ${error}`,
          error: new Error(`oauth_error:${error}`),
        });
        return;
      }
      const code = (url.searchParams.get("code") ?? "").trim();
      if (!code) {
        complete({
          ok: false,
          message: "Missing OAuth code.",
          error: new Error("missing_oauth_code"),
        });
        return;
      }

      try {
        const addr = server.address() as AddressInfo | null;
        const port = addr?.port ?? this.deps.redirectPort;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const tokens = await exchangeAuthCode({
          fetch: this.deps.fetch,
          clientId,
          code,
          verifier,
          redirectUri,
        });

        const existingRefresh = readEncryptedToken(this.deps.secureStore, GOOGLE_REFRESH_ACCOUNT);
        const refreshToken = tokens.refreshToken ?? existingRefresh;
        if (!refreshToken) {
          throw new Error("missing refresh token; re-auth with prompt=consent");
        }

        const userinfo = await fetchUserInfo({
          fetch: this.deps.fetch,
          accessToken: tokens.accessToken,
        });

        writeEncryptedToken(this.deps.secureStore, GOOGLE_ACCESS_ACCOUNT, tokens.accessToken);
        writeEncryptedToken(this.deps.secureStore, GOOGLE_REFRESH_ACCOUNT, refreshToken);

        const identity: GoogleIdentityRecord = {
          ...userinfo,
          expiresAtMs: tokens.expiresAtMs,
        };
        writeIdentityRecord(this.deps.secureStore, identity);

        respondCallback(res, { ok: true, message: "You’re signed in." });
        resolveFn(identity);
      } catch (err) {
        complete({
          ok: false,
          message: "Token exchange failed.",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      } finally {
        this.closeSession(sessionId);
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", (err) => reject(err));
      server.listen(this.deps.redirectPort, "127.0.0.1", () => resolve());
    });

    const addr = server.address() as AddressInfo | null;
    const port = addr?.port ?? this.deps.redirectPort;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl = buildAuthUrl({
      clientId,
      redirectUri,
      state,
      challenge,
    });
    const entry: PendingGoogleSignIn = {
      sessionId,
      state,
      verifier,
      server,
      resolve: resolveFn,
      reject: rejectFn,
      promise,
    };
    this.pending.set(sessionId, entry);
    return { sessionId, authUrl };
  }

  async waitSignIn(sessionId: string, timeoutMs = 5 * 60 * 1000): Promise<GoogleIdentityRecord> {
    const entry = this.pending.get(sessionId);
    if (!entry) {
      throw new Error("google sign-in session not found");
    }
    const timeout = Math.max(0, Math.floor(timeoutMs));
    if (timeout === 0) {
      return await entry.promise;
    }
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<GoogleIdentityRecord>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.closeSession(sessionId);
        reject(new Error("google sign-in timed out"));
      }, timeout);
    });
    try {
      return await Promise.race([entry.promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async signOut(): Promise<void> {
    this.deps.secureStore.delete(GOOGLE_ACCESS_ACCOUNT);
    this.deps.secureStore.delete(GOOGLE_REFRESH_ACCOUNT);
    this.deps.secureStore.delete(GOOGLE_IDENTITY_ACCOUNT);
  }
}

let DEFAULT_SERVICE: GoogleIdentityService | null = null;

export function getGoogleIdentityService(): GoogleIdentityService {
  if (DEFAULT_SERVICE) {
    return DEFAULT_SERVICE;
  }
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }
  DEFAULT_SERVICE = new GoogleIdentityService({
    env: process.env,
    fetch: fetchImpl,
    now: () => Date.now(),
    secureStore: createDefaultSecureStore(),
    redirectPort: 51121,
  });
  return DEFAULT_SERVICE;
}
