import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadAuthProfileStore } from "../agents/auth-profiles/store.js";
import {
  AUTH_PROFILE_SECURE_STORE_SERVICE,
  parseSecureStoreRef,
} from "../agents/auth-profiles/secure-store.js";
import {
  readSecureStoreSecret,
  resetSecureStoreMemoryBackendForTest,
} from "../infra/secure-store.js";
import { decryptFromStorage } from "./storage-crypto.js";

describe("Mindfly V1 secure-store migration spec", () => {
  const previousEnv: Record<string, string | undefined> = {};

  afterEach(async () => {
    for (const key of Object.keys(previousEnv)) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (const key of Object.keys(previousEnv)) {
      delete previousEnv[key];
    }
    resetSecureStoreMemoryBackendForTest();
  });

  it("migrates plaintext api keys in auth-profiles.json into secure store refs in mindfly mode", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mindfly-migration-home-"));
    const agentDir = path.join(homeDir, ".openclaw", "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true });

    const authPath = path.join(agentDir, "auth-profiles.json");
    const plaintext = "sk-test-plaintext";
    await fs.writeFile(
      authPath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "anthropic:default": { type: "api_key", provider: "anthropic", key: plaintext },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    previousEnv.HOME = process.env.HOME;
    previousEnv.USERPROFILE = process.env.USERPROFILE;
    previousEnv.OPENCLAW_BRAND = process.env.OPENCLAW_BRAND;
    previousEnv.OPENCLAW_SECURE_STORE_BACKEND = process.env.OPENCLAW_SECURE_STORE_BACKEND;
    previousEnv.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID;
    previousEnv.OPENCLAW_INSTALL_UUID = process.env.OPENCLAW_INSTALL_UUID;

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.OPENCLAW_BRAND = "mindfly";
    process.env.OPENCLAW_SECURE_STORE_BACKEND = "memory";
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "test-machine";
    process.env.OPENCLAW_INSTALL_UUID = "install-1";

    const store = loadAuthProfileStore();
    const cred = store.profiles["anthropic:default"];
    expect(cred?.type).toBe("api_key");
    const key = (cred as { key?: string }).key ?? "";
    expect(key).toMatch(/^secure:/);
    expect(key).not.toContain(plaintext);

    const saved = await fs.readFile(authPath, "utf8");
    expect(saved).toContain("secure:");
    expect(saved).not.toContain(plaintext);

    const account = parseSecureStoreRef(key);
    expect(account).toBeTruthy();

    const decision = readSecureStoreSecret({
      service: AUTH_PROFILE_SECURE_STORE_SERVICE,
      account: account!,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      return;
    }

    // Stored secret is ciphertext; decrypt yields original plaintext.
    expect(decision.secret).not.toContain(plaintext);
    const installUuid = process.env.OPENCLAW_INSTALL_UUID;
    expect(installUuid).toBeTruthy();
    if (!installUuid) {
      throw new Error("missing OPENCLAW_INSTALL_UUID");
    }
    const decrypted = decryptFromStorage(decision.secret, installUuid);
    expect(decrypted).toBe(plaintext);
  });
});
