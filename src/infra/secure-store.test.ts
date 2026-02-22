import { describe, expect, it } from "vitest";

import {
  deleteSecureStoreSecret,
  readSecureStoreSecret,
  writeSecureStoreSecret,
} from "./secure-store.js";

describe("secure-store", () => {
  it("reads secrets on darwin via security", () => {
    const execSyncMock = () => "hello\n";
    const result = readSecureStoreSecret({
      service: "svc",
      account: "acct",
      platform: "darwin",
      execSync: execSyncMock as unknown as typeof import("node:child_process").execSync,
    });
    expect(result).toEqual({ ok: true, secret: "hello" });
  });

  it("returns not_found on darwin when security fails", () => {
    const execSyncMock = () => {
      throw new Error("nope");
    };
    const result = readSecureStoreSecret({
      service: "svc",
      account: "acct",
      platform: "darwin",
      execSync: execSyncMock as unknown as typeof import("node:child_process").execSync,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_found");
    }
  });

  it("reads secrets on win32 via powershell json", () => {
    const spawnSyncMock = () =>
      ({
        stdout: JSON.stringify({
          ok: true,
          secretB64: Buffer.from("hello", "utf8").toString("base64"),
        }),
      }) as unknown as ReturnType<typeof import("node:child_process").spawnSync>;

    const result = readSecureStoreSecret({
      service: "svc",
      account: "acct",
      platform: "win32",
      spawnSync: spawnSyncMock as unknown as typeof import("node:child_process").spawnSync,
    });
    expect(result).toEqual({ ok: true, secret: "hello" });
  });

  it("writes secrets on win32 via powershell json", () => {
    const spawnSyncMock = () =>
      ({
        stdout: JSON.stringify({ ok: true }),
      }) as unknown as ReturnType<typeof import("node:child_process").spawnSync>;

    const result = writeSecureStoreSecret({
      service: "svc",
      account: "acct",
      secret: "hello",
      platform: "win32",
      spawnSync: spawnSyncMock as unknown as typeof import("node:child_process").spawnSync,
    });
    expect(result).toEqual({ ok: true });
  });

  it("deletes secrets on win32 via powershell json", () => {
    const spawnSyncMock = () =>
      ({
        stdout: JSON.stringify({ ok: true }),
      }) as unknown as ReturnType<typeof import("node:child_process").spawnSync>;

    const result = deleteSecureStoreSecret({
      service: "svc",
      account: "acct",
      platform: "win32",
      spawnSync: spawnSyncMock as unknown as typeof import("node:child_process").spawnSync,
    });
    expect(result).toEqual({ ok: true });
  });
});
