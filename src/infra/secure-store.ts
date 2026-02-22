import { execSync, spawnSync } from "node:child_process";

export type SecureStoreDecision = { ok: true; secret: string } | { ok: false; error: string };

type MemoryKey = `${string}::${string}`;
const MEMORY_BACKEND = new Map<MemoryKey, string>();

function isMemoryBackendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.OPENCLAW_SECURE_STORE_BACKEND ?? "").trim().toLowerCase() === "memory";
}

export function resetSecureStoreMemoryBackendForTest(): void {
  MEMORY_BACKEND.clear();
}

function escapeMacArg(value: string): string {
  return value.replace(/"/g, '\\"');
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

const WINDOWS_CRED_SCRIPT = `
$ErrorActionPreference = "Stop"
$action = ($env:OPENCLAW_SECURE_STORE_ACTION ?? "").Trim()
$target = ($env:OPENCLAW_SECURE_STORE_TARGET ?? "").Trim()
$username = ($env:OPENCLAW_SECURE_STORE_USERNAME ?? "").Trim()
$secretB64 = ($env:OPENCLAW_SECURE_STORE_SECRET_B64 ?? "").Trim()

if (-not $action) { throw "missing action" }
if (-not $target) { throw "missing target" }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CredMan {
  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

  [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, uint flags);

  [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, uint type, uint flags);

  [DllImport("Advapi32.dll", SetLastError = true)]
  public static extern void CredFree([In] IntPtr cred);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
}
"@

$CRED_TYPE_GENERIC = 1
$CRED_PERSIST_LOCAL_MACHINE = 2

function Out-Result([bool]$ok, [string]$error, [string]$secret) {
  $payload = @{ ok = $ok }
  if ($error) { $payload.error = $error }
  if ($secret) {
    $payload.secretB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($secret))
  }
  $payload | ConvertTo-Json -Compress
}

if ($action -eq "read") {
  $ptr = [IntPtr]::Zero
  $ok = [CredMan]::CredRead($target, $CRED_TYPE_GENERIC, 0, [ref]$ptr)
  if (-not $ok) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) { # ERROR_NOT_FOUND
      Out-Result $false "not_found" ""
      exit 0
    }
    Out-Result $false ("credread_failed:" + $err) ""
    exit 0
  }
  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
    if ($cred.CredentialBlobSize -le 0) {
      Out-Result $false "empty_secret" ""
      exit 0
    }
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    $secret = [System.Text.Encoding]::Unicode.GetString($bytes).TrimEnd([char]0)
    Out-Result $true "" $secret
    exit 0
  } finally {
    [CredMan]::CredFree($ptr)
  }
}

if ($action -eq "write") {
  if (-not $secretB64) { throw "missing secretB64" }
  $secret = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($secretB64))
  $secretBytes = [System.Text.Encoding]::Unicode.GetBytes($secret)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($secretBytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($secretBytes, 0, $blob, $secretBytes.Length)
    $cred = New-Object CredMan+CREDENTIAL
    $cred.Flags = 0
    $cred.Type = $CRED_TYPE_GENERIC
    $cred.TargetName = $target
    $cred.Comment = ""
    $cred.CredentialBlobSize = $secretBytes.Length
    $cred.CredentialBlob = $blob
    $cred.Persist = $CRED_PERSIST_LOCAL_MACHINE
    $cred.AttributeCount = 0
    $cred.Attributes = [IntPtr]::Zero
    $cred.TargetAlias = ""
    $cred.UserName = $username
    $ok = [CredMan]::CredWrite([ref]$cred, 0)
    if (-not $ok) {
      $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      Out-Result $false ("credwrite_failed:" + $err) ""
      exit 0
    }
    Out-Result $true "" ""
    exit 0
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
  }
}

if ($action -eq "delete") {
  $ok = [CredMan]::CredDelete($target, $CRED_TYPE_GENERIC, 0)
  if (-not $ok) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Out-Result $true "" ""
      exit 0
    }
    Out-Result $false ("creddelete_failed:" + $err) ""
    exit 0
  }
  Out-Result $true "" ""
  exit 0
}

throw ("unsupported action: " + $action)
`.trim();

function buildWindowsTarget(service: string, account: string): string {
  return `openclaw:${service}|${account}`;
}

export function readSecureStoreSecret(params: {
  service: string;
  account: string;
  platform?: NodeJS.Platform;
  execSync?: typeof execSync;
  spawnSync?: typeof spawnSync;
}): SecureStoreDecision {
  if (isMemoryBackendEnabled()) {
    const key: MemoryKey = `${params.service}::${params.account}`;
    const secret = MEMORY_BACKEND.get(key);
    return secret ? { ok: true, secret } : { ok: false, error: "not_found" };
  }
  const platform = params.platform ?? process.platform;
  if (platform === "darwin") {
    const execSyncImpl = params.execSync ?? execSync;
    try {
      const output = execSyncImpl(
        `security find-generic-password -s "${escapeMacArg(params.service)}" -a "${escapeMacArg(params.account)}" -w`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
      );
      const secret = output.trim();
      if (!secret) {
        return { ok: false, error: "empty_secret" };
      }
      return { ok: true, secret };
    } catch {
      return { ok: false, error: "not_found" };
    }
  }

  if (platform === "win32") {
    const spawnSyncImpl = params.spawnSync ?? spawnSync;
    const encoded = encodePowerShell(WINDOWS_CRED_SCRIPT);
    const target = buildWindowsTarget(params.service, params.account);
    const res = spawnSyncImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_SECURE_STORE_ACTION: "read",
          OPENCLAW_SECURE_STORE_TARGET: target,
          OPENCLAW_SECURE_STORE_USERNAME: params.account,
        },
        windowsHide: true,
        timeout: 10_000,
      },
    );
    if (res.error) {
      return { ok: false, error: `spawn_failed:${String(res.error)}` };
    }
    const stdout = (res.stdout ?? "").trim();
    if (!stdout) {
      return { ok: false, error: "empty_response" };
    }
    try {
      const parsed = JSON.parse(stdout) as { ok?: unknown; error?: unknown; secretB64?: unknown };
      if (parsed.ok !== true) {
        return {
          ok: false,
          error: typeof parsed.error === "string" && parsed.error ? parsed.error : "read_failed",
        };
      }
      const secretB64 = typeof parsed.secretB64 === "string" ? parsed.secretB64 : "";
      if (!secretB64) {
        return { ok: false, error: "empty_secret" };
      }
      const secret = Buffer.from(secretB64, "base64").toString("utf8");
      return { ok: true, secret };
    } catch (err) {
      return { ok: false, error: `parse_failed:${String(err)}` };
    }
  }

  return { ok: false, error: "unsupported_platform" };
}

export function writeSecureStoreSecret(params: {
  service: string;
  account: string;
  secret: string;
  platform?: NodeJS.Platform;
  execSync?: typeof execSync;
  spawnSync?: typeof spawnSync;
}): { ok: true } | { ok: false; error: string } {
  if (isMemoryBackendEnabled()) {
    const key: MemoryKey = `${params.service}::${params.account}`;
    MEMORY_BACKEND.set(key, params.secret);
    return { ok: true };
  }
  const platform = params.platform ?? process.platform;
  if (platform === "darwin") {
    const execSyncImpl = params.execSync ?? execSync;
    try {
      execSyncImpl(
        `security add-generic-password -U -s "${escapeMacArg(params.service)}" -a "${escapeMacArg(params.account)}" -w '${params.secret.replace(/'/g, `'"'"'`)}'`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `write_failed:${String(err)}` };
    }
  }

  if (platform === "win32") {
    const spawnSyncImpl = params.spawnSync ?? spawnSync;
    const encoded = encodePowerShell(WINDOWS_CRED_SCRIPT);
    const target = buildWindowsTarget(params.service, params.account);
    const secretB64 = Buffer.from(params.secret, "utf8").toString("base64");
    const res = spawnSyncImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_SECURE_STORE_ACTION: "write",
          OPENCLAW_SECURE_STORE_TARGET: target,
          OPENCLAW_SECURE_STORE_USERNAME: params.account,
          OPENCLAW_SECURE_STORE_SECRET_B64: secretB64,
        },
        windowsHide: true,
        timeout: 10_000,
      },
    );
    if (res.error) {
      return { ok: false, error: `spawn_failed:${String(res.error)}` };
    }
    const stdout = (res.stdout ?? "").trim();
    if (!stdout) {
      return { ok: false, error: "empty_response" };
    }
    try {
      const parsed = JSON.parse(stdout) as { ok?: unknown; error?: unknown };
      if (parsed.ok !== true) {
        return {
          ok: false,
          error: typeof parsed.error === "string" && parsed.error ? parsed.error : "write_failed",
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `parse_failed:${String(err)}` };
    }
  }

  return { ok: false, error: "unsupported_platform" };
}

export function deleteSecureStoreSecret(params: {
  service: string;
  account: string;
  platform?: NodeJS.Platform;
  execSync?: typeof execSync;
  spawnSync?: typeof spawnSync;
}): { ok: true } | { ok: false; error: string } {
  if (isMemoryBackendEnabled()) {
    const key: MemoryKey = `${params.service}::${params.account}`;
    MEMORY_BACKEND.delete(key);
    return { ok: true };
  }
  const platform = params.platform ?? process.platform;
  if (platform === "darwin") {
    const execSyncImpl = params.execSync ?? execSync;
    try {
      execSyncImpl(
        `security delete-generic-password -s "${escapeMacArg(params.service)}" -a "${escapeMacArg(params.account)}"`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
      );
      return { ok: true };
    } catch {
      return { ok: true };
    }
  }

  if (platform === "win32") {
    const spawnSyncImpl = params.spawnSync ?? spawnSync;
    const encoded = encodePowerShell(WINDOWS_CRED_SCRIPT);
    const target = buildWindowsTarget(params.service, params.account);
    const res = spawnSyncImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_SECURE_STORE_ACTION: "delete",
          OPENCLAW_SECURE_STORE_TARGET: target,
          OPENCLAW_SECURE_STORE_USERNAME: params.account,
        },
        windowsHide: true,
        timeout: 10_000,
      },
    );
    if (res.error) {
      return { ok: false, error: `spawn_failed:${String(res.error)}` };
    }
    const stdout = (res.stdout ?? "").trim();
    if (!stdout) {
      return { ok: false, error: "empty_response" };
    }
    try {
      const parsed = JSON.parse(stdout) as { ok?: unknown; error?: unknown };
      if (parsed.ok !== true) {
        return {
          ok: false,
          error: typeof parsed.error === "string" && parsed.error ? parsed.error : "delete_failed",
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `parse_failed:${String(err)}` };
    }
  }

  return { ok: false, error: "unsupported_platform" };
}
