import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveInstallUuid } from "./install-uuid.js";

describe("install uuid", () => {
  it("persists and reuses a generated install uuid under the state dir", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-install-uuid-"));
    const env = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };
    delete env.OPENCLAW_INSTALL_UUID;
    delete env.OPENCLAW_STATE_DIR;

    const a = resolveInstallUuid({ env, homedir: () => tempHome, fs });
    const b = resolveInstallUuid({ env, homedir: () => tempHome, fs });

    expect(a).toEqual(b);
    expect(a).toMatch(/[0-9a-f-]{36}/i);
  });

  it("respects OPENCLAW_INSTALL_UUID override", () => {
    const env = { ...process.env, OPENCLAW_INSTALL_UUID: "override-123" };
    expect(resolveInstallUuid({ env })).toBe("override-123");
  });
});
