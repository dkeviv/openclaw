import { describe, expect, it } from "vitest";

import { resolveMindflyGatewayToken } from "./mindfly-gateway-token.js";

const MACHINE_ID = "test-machine";

describe("resolveMindflyGatewayToken", () => {
  it("stores a stable token", () => {
    const store = new Map<string, string>();
    const client = {
      read: (account: string) => {
        const secret = store.get(account);
        return secret ? { ok: true as const, secret } : { ok: false as const, error: "not_found" };
      },
      write: (account: string, secret: string) => {
        store.set(account, secret);
        return { ok: true as const };
      },
    };

    const installUuid = "install-1";
    process.env.OPENCLAW_INSTALL_UUID = installUuid;
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = MACHINE_ID;
    try {
      const a = resolveMindflyGatewayToken(client);
      const b = resolveMindflyGatewayToken(client);
      expect(a).toBeTruthy();
      expect(b).toBe(a);
      expect(a).not.toContain(":");
      expect(store.size).toBe(1);
    } finally {
      delete process.env.OPENCLAW_INSTALL_UUID;
      delete process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID;
    }
  });
});
