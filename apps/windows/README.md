# Mindfly (Windows) — Electron App (V1 Scaffold)

This folder contains the Windows desktop wrapper for Mindfly.

## Goals (V1)

- Start the OpenClaw gateway locally (loopback only).
- Enforce gateway auth token (bearer token).
- Load the existing web Control UI bundle from disk (no HTML served by the gateway).
- Provide a preload bridge that injects the gateway URL + token into the renderer without using URLs or disk.

## Development (local)

This is a scaffold. The gateway binary/packaging flow is not wired into CI yet.

Recommended dev loop (from repo root):

1) Build the web UI:
   - `pnpm -C ui build`

2) Run the gateway separately (loopback + token):
   - `OPENCLAW_GATEWAY_TOKEN="<token>" pnpm gateway:dev`

3) Start Electron (from this folder, once dependencies are installed):
   - `npm install`
   - `npm run dev`

## Security notes

- The renderer must never persist secrets to disk (no `localStorage`/URLs/logs).
- The gateway token is passed via an in-memory IPC bridge from the main process to the renderer.
- Any tool subprocesses spawned by agent tools must run with a sanitized environment (implemented in core).

