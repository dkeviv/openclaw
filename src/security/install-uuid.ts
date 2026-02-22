import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveStateDir } from "../config/paths.js";

const INSTALL_UUID_FILENAME = "install.json";
const INSTALL_UUID_VERSION = 1;

type InstallUuidFile = {
  version: number;
  installUuid: string;
};

function coerceInstallUuidFile(raw: unknown): InstallUuidFile | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.installUuid !== "string" || !record.installUuid.trim()) {
    return null;
  }
  const version =
    typeof record.version === "number" && Number.isFinite(record.version) ? record.version : 0;
  return { version, installUuid: record.installUuid.trim() };
}

export function resolveInstallUuid(options?: {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  fs?: typeof fs;
}): string {
  const env = options?.env ?? process.env;
  const override = (env.OPENCLAW_INSTALL_UUID ?? "").trim();
  if (override) {
    return override;
  }

  const fsImpl = options?.fs ?? fs;
  const stateDir = resolveStateDir(env, options?.homedir ?? os.homedir);
  const filePath = path.join(stateDir, INSTALL_UUID_FILENAME);

  try {
    if (fsImpl.existsSync(filePath)) {
      const raw = fsImpl.readFileSync(filePath, "utf8");
      const parsed = coerceInstallUuidFile(JSON.parse(raw));
      if (parsed) {
        return parsed.installUuid;
      }
    }
  } catch {
    // fall through to regeneration
  }

  const installUuid = crypto.randomUUID();
  const payload: InstallUuidFile = { version: INSTALL_UUID_VERSION, installUuid };
  try {
    fsImpl.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    fsImpl.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  } catch (err) {
    throw new Error(`Failed to persist install uuid: ${String(err)}`, { cause: err });
  }
  return installUuid;
}
