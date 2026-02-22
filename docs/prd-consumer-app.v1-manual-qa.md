# Mindfly PRD (V1) — Manual QA Checklist

This checklist covers flows that are difficult/impossible to fully verify in automated tests because they depend on real OS UI surfaces (OAuth sheets, Keychain prompts, installers) or require live credentials.

## A) Google OAuth (mandatory sign-in)

**Goal:** Sign-in is required and tokens are handled securely.

- [ ] Fresh install / first launch shows Step 0 “Continue with Google”; no anonymous mode.
- [ ] OAuth opens via the platform-appropriate mechanism (macOS `ASWebAuthenticationSession`, Windows external browser + local redirect).
- [ ] Successful sign-in stores refresh/access tokens in the OS credential store (not in config files, logs, or URLs).
- [ ] Relaunch: user stays signed in (until explicit sign-out), no repeated prompts.
- [ ] Sign-out removes tokens from the OS credential store and revokes local access.

## B) OS credential store (Keychain / Credential Manager)

**Goal:** No secrets are stored in plaintext config files; secrets live only in the OS secure store.

- [ ] Verify `~/.openclaw/openclaw.json` contains only non-secrets (no provider keys, no Google tokens, no gateway token).
- [ ] macOS: Keychain Access → search for “mindfly” entries; confirm expected items exist and are updated on changes.
- [ ] Windows: Credential Manager → confirm expected items exist and are updated on changes.
- [ ] Update a provider API key in Settings → confirm the secure store updates and the gateway runtime refreshes.

## C) Gateway security (token + loopback)

**Goal:** Gateway is not usable without token; consumer defaults are loopback-only.

- [ ] Gateway binds to loopback by default; not reachable from LAN.
- [ ] Connecting with a missing/invalid token is denied; valid token succeeds.
- [ ] Rotate/reset token (when implemented) disconnects existing sessions and requires the new token.

## D) Tool approvals (default-deny)

**Goal:** Side-effecting tools never run silently when approval is required.

- [ ] Trigger an approval-required action (e.g., `exec` with ask=always) and **do not respond** → verify it times out and is denied.
- [ ] File tools: attempt a first-time `write`/`edit`/`apply_patch` in a new folder → verify a permission prompt appears; **Allow once** → subsequent ops in that folder work for the rest of the session; **Always allow** → a new session skips the prompt for that folder.
- [ ] Browser tools: first `browser snapshot` (read) prompts; subsequent read actions do not. First `browser open/act` (control) prompts; subsequent control actions do not. (`evaluate`, if enabled, should prompt every time.)
- [ ] Verify no action runs after denial (no background execution).
- [ ] Verify the UI shows a clear denial reason (timeout vs user-denied).

## E) Prompt injection safety (tool-returned content is untrusted)

**Goal:** Tool outputs are clearly wrapped as untrusted data before the model sees them.

- [ ] Run `browser.snapshot` / `web_fetch` on a page containing obvious injection text (“ignore previous instructions…”) → verify the returned content is wrapped with untrusted boundaries and a warning block.
- [ ] Verify tool output content never triggers automatic side effects; approvals still gate actions.

## F) Installers (macOS/Windows)

**Goal:** Installer-driven defaults match the PRD.

- [ ] Installer/first-run obtains consent for background gateway behavior (EULA language).
- [ ] Gateway auto-starts on app launch; no terminal steps required.
- [ ] Uninstall removes app + background entry points (where applicable) and does not leave the gateway running.
