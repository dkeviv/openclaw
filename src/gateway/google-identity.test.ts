import http from "node:http";

import { describe, expect, it } from "vitest";

import { GoogleIdentityService } from "./google-identity.js";

function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.on("error", reject);
  });
}

describe("GoogleIdentityService", () => {
  it("completes PKCE sign-in via loopback callback", async () => {
    const secrets = new Map<string, string>();
    const secureStore = {
      read: (account: string) => {
        const secret = secrets.get(account);
        return secret ? { ok: true as const, secret } : { ok: false as const, error: "not_found" };
      },
      write: (account: string, secret: string) => {
        secrets.set(account, secret);
        return { ok: true as const };
      },
      delete: (account: string) => {
        secrets.delete(account);
        return { ok: true as const };
      },
    };

    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = async (input: any, init?: any) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, body });
      if (url.includes("oauth2.googleapis.com/token")) {
        const params = new URLSearchParams(body ?? "");
        const grant = params.get("grant_type");
        if (grant === "authorization_code") {
          const codeVerifier = params.get("code_verifier") ?? "";
          if (!codeVerifier.trim()) {
            return new Response(JSON.stringify({ error: "missing_verifier" }), { status: 400 });
          }
          return new Response(
            JSON.stringify({
              access_token: "access-1",
              refresh_token: "refresh-1",
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        if (grant === "refresh_token") {
          return new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600 }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "unsupported_grant" }), { status: 400 });
      }
      if (url.includes("www.googleapis.com/oauth2/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            email: "user@example.com",
            name: "User",
            picture: "https://example.com/pic.png",
            id: "123",
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const env: NodeJS.ProcessEnv = {
      OPENCLAW_BRAND: "mindfly",
      MINDFLY_GOOGLE_CLIENT_ID: "test-client",
    };

    const prevInstall = process.env.OPENCLAW_INSTALL_UUID;
    const prevMachineId = process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID;
    process.env.OPENCLAW_INSTALL_UUID = "install-1";
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "machine-1";
    try {
      const service = new GoogleIdentityService({
        env,
        fetch: fetchImpl as unknown as typeof fetch,
        now: () => Date.now(),
        secureStore,
        redirectPort: 0,
      });

      const { sessionId, authUrl } = await service.startSignIn();
      const url = new URL(authUrl);
      const state = url.searchParams.get("state") ?? "";
      const redirect = url.searchParams.get("redirect_uri") ?? "";
      expect(sessionId).toBeTruthy();
      expect(state).toBeTruthy();
      expect(redirect).toContain("127.0.0.1");

      const wait = service.waitSignIn(sessionId, 5000);
      await httpGet(`${redirect}?code=test-code&state=${encodeURIComponent(state)}`);
      const identity = await wait;

      expect(identity.email).toBe("user@example.com");
      expect(identity.name).toBe("User");
      expect(identity.picture).toBe("https://example.com/pic.png");
      expect(identity.id).toBe("123");
      expect(identity.expiresAtMs).toBeGreaterThan(Date.now());
      expect(secrets.get("google-access-token")).toContain(":");
      expect(secrets.get("google-refresh-token")).toContain(":");
      expect(secrets.get("google-identity")).toContain("user@example.com");

      // Force refresh by expiring identity.
      const expired = { ...identity, expiresAtMs: 1 };
      secureStore.write("google-identity", JSON.stringify(expired));
      const refreshed = await service.getIdentity();
      expect(refreshed?.expiresAtMs).toBeGreaterThan(1);
    } finally {
      if (prevInstall === undefined) {
        delete process.env.OPENCLAW_INSTALL_UUID;
      } else {
        process.env.OPENCLAW_INSTALL_UUID = prevInstall;
      }
      if (prevMachineId === undefined) {
        delete process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID;
      } else {
        process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = prevMachineId;
      }
    }

    expect(calls.some((c) => c.url.includes("oauth2.googleapis.com/token"))).toBe(true);
    expect(calls.some((c) => c.url.includes("www.googleapis.com/oauth2/v1/userinfo"))).toBe(true);
  });
});
