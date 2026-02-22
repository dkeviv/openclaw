import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthProfileStore } from "./types.js";

describe("auth-profiles secure store", () => {
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    previousEnv = { ...process.env };
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-secure-store-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.OPENCLAW_AUTH_SECURE_STORE = "1";
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "test-machine-id";
  });

  afterEach(() => {
    process.env = previousEnv;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("migrates auth profile secrets to secure store refs and resolves them", async () => {
    const mod = await import("./secure-store.js");
    const secrets = new Map<string, string>();
    const client = {
      read: (account) => {
        const secret = secrets.get(account);
        return secret ? { ok: true, secret } : { ok: false, error: "not_found" };
      },
      write: (account, secret) => {
        secrets.set(account, secret);
        return { ok: true };
      },
    };

    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "anthropic:default": { type: "api_key", provider: "anthropic", key: "sk-anthropic" },
        "openai:default": { type: "token", provider: "openai", token: "tok-openai" },
        "google-antigravity:default": {
          type: "oauth",
          provider: "google-antigravity",
          access: "acc-google",
          refresh: "ref-google",
          expires: Date.now() + 60_000,
        },
      },
    };

    const migrated = mod.migrateAuthProfileStoreToSecureStore(store, client);
    expect(migrated).toBe(true);

    const anthropic = store.profiles["anthropic:default"];
    expect(anthropic?.type).toBe("api_key");
    if (anthropic?.type === "api_key") {
      expect(anthropic.key).toMatch(/^secure:/);
      expect(mod.resolveAuthProfileSecret(anthropic.key, client)).toBe("sk-anthropic");
    }

    const openai = store.profiles["openai:default"];
    expect(openai?.type).toBe("token");
    if (openai?.type === "token") {
      expect(openai.token).toMatch(/^secure:/);
      expect(mod.resolveAuthProfileSecret(openai.token, client)).toBe("tok-openai");
    }

    const google = store.profiles["google-antigravity:default"];
    expect(google?.type).toBe("oauth");
    if (google?.type === "oauth") {
      expect(google.access).toMatch(/^secure:/);
      expect(google.refresh).toMatch(/^secure:/);
      expect(mod.resolveAuthProfileSecret(google.access, client)).toBe("acc-google");
      expect(mod.resolveAuthProfileSecret(google.refresh, client)).toBe("ref-google");
    }
  });
});
