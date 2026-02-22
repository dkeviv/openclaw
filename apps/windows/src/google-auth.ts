import { shell } from "electron";

export async function openGoogleAuthUrl(authUrl: string): Promise<void> {
  const trimmed = authUrl.trim();
  if (!trimmed) {
    throw new Error("authUrl is required");
  }
  await shell.openExternal(trimmed);
}

