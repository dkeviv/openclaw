import { describe, expect, it } from "vitest";

import {
  decryptFromStorage,
  encryptForStorage,
  resetStorageCryptoCachesForTest,
} from "./storage-crypto.js";

describe("storage-crypto", () => {
  it("roundtrips plaintext with the same installUuid", () => {
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "test-machine-id";
    resetStorageCryptoCachesForTest();

    const installUuid = "install-123";
    const secret = "hello world";
    const encrypted = encryptForStorage(secret, installUuid);

    expect(decryptFromStorage(encrypted, installUuid)).toBe(secret);
  });

  it("produces different ciphertext across encryptions (random IV)", () => {
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "test-machine-id";
    resetStorageCryptoCachesForTest();

    const installUuid = "install-123";
    const secret = "hello world";
    const a = encryptForStorage(secret, installUuid);
    const b = encryptForStorage(secret, installUuid);

    expect(a).not.toBe(b);
  });

  it("fails to decrypt with a different installUuid", () => {
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "test-machine-id";
    resetStorageCryptoCachesForTest();

    const secret = "hello world";
    const encrypted = encryptForStorage(secret, "install-a");

    expect(() => decryptFromStorage(encrypted, "install-b")).toThrow();
  });

  it("rejects invalid ciphertext format", () => {
    process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID = "test-machine-id";
    resetStorageCryptoCachesForTest();

    expect(() => decryptFromStorage("not-a-ciphertext", "install-123")).toThrow(
      /Invalid storage ciphertext format/,
    );
  });
});
