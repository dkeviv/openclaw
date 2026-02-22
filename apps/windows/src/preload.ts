import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__MINDFLY__", {
  getGatewayToken: () => ipcRenderer.invoke("mindfly:get-gateway-token") as Promise<string>,
  getGatewayUrl: () => ipcRenderer.invoke("mindfly:get-gateway-url") as Promise<string>,
});

