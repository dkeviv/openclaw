const DEFAULT_SENSITIVE_ENV_KEYS = [
  "OPENCLAW_GATEWAY_TOKEN",
  "CLAWDBOT_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_PASSWORD",
  "CLAWDBOT_GATEWAY_PASSWORD",
] as const;

export type SensitiveEnvKey = (typeof DEFAULT_SENSITIVE_ENV_KEYS)[number];

export type ScrubInheritedEnvOptions = {
  /**
   * When the caller explicitly provides an override (e.g. tool params.env),
   * keep that key in the resulting environment.
   */
  keepIfProvided?: Record<string, string> | undefined;
  /**
   * Override the default list (advanced use; prefer defaults).
   */
  keys?: readonly string[];
};

/**
 * SECURITY: Scrub inherited secrets from a tool subprocess environment.
 *
 * This is a defense-in-depth layer to prevent gateway auth material from being
 * accidentally inherited by spawned commands (exec tool), which can then leak
 * via logs, network calls, or third-party CLIs.
 *
 * Note: Explicit tool-provided env overrides are respected (keepIfProvided),
 * so advanced users can still intentionally pass credentials.
 */
export function scrubInheritedSensitiveEnv(
  env: Record<string, string>,
  options: ScrubInheritedEnvOptions = {},
) {
  const keys = options.keys ?? DEFAULT_SENSITIVE_ENV_KEYS;
  const keep = options.keepIfProvided;
  for (const key of keys) {
    if (keep && Object.prototype.hasOwnProperty.call(keep, key)) {
      continue;
    }
    delete env[key];
  }
}
