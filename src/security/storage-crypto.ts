import { execSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";

const STORAGE_CRYPTO_SALT_PREFIX = "mindfly-v1-salt:";

let cachedMachineId: string | null = null;

function readLinuxMachineId(): string | null {
  const candidates = ["/etc/machine-id", "/var/lib/dbus/machine-id"];
  for (const filePath of candidates) {
    try {
      const value = fs.readFileSync(filePath, "utf8").trim();
      if (value) {
        return value;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function readMacMachineId(execSyncImpl: typeof execSync = execSync): string | null {
  try {
    const output = execSyncImpl("ioreg -rd1 -c IOPlatformExpertDevice", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function readWindowsMachineId(execSyncImpl: typeof execSync = execSync): string | null {
  try {
    const output = execSyncImpl(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function resolveMachineId(): string {
  const override = (process.env.OPENCLAW_STORAGE_CRYPTO_MACHINE_ID ?? "").trim();
  if (override) {
    return override;
  }
  if (cachedMachineId) {
    return cachedMachineId;
  }

  const resolved =
    process.platform === "darwin"
      ? readMacMachineId()
      : process.platform === "win32"
        ? readWindowsMachineId()
        : readLinuxMachineId();

  if (!resolved) {
    throw new Error(
      "storage-crypto unavailable: failed to resolve machine id (set OPENCLAW_STORAGE_CRYPTO_MACHINE_ID to override in tests).",
    );
  }
  cachedMachineId = resolved;
  return resolved;
}

function deriveMachineKey(installUuid: string): Buffer {
  const machineId = resolveMachineId();
  const salt = Buffer.from(STORAGE_CRYPTO_SALT_PREFIX + installUuid, "utf8");
  return scryptSync(machineId, salt, 32);
}

/**
 * Encrypt secrets for storage in OS credential stores (Keychain/Credential Manager).
 *
 * Format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encryptForStorage(plaintext: string, installUuid: string): string {
  const key = deriveMachineKey(installUuid);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    ":",
  );
}

export function decryptFromStorage(stored: string, installUuid: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Invalid storage ciphertext format.");
  }
  const key = deriveMachineKey(installUuid);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return decipher.update(Buffer.from(ciphertextB64, "base64")) + decipher.final("utf8");
}

export function resetStorageCryptoCachesForTest(): void {
  cachedMachineId = null;
}
