import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("clicky", {
  onRecordingChanged: (callback: (isRecording: boolean) => void) => {
    ipcRenderer.on("hotkey:recording-changed", (_event, isRecording) => {
      callback(isRecording);
    });
  },

  onPoint: (
    callback: (
      tags: Array<{ x: number; y: number; label: string; screen: number }>
    ) => void
  ) => {
    ipcRenderer.on("overlay:point", (_event, tags) => {
      callback(tags);
    });
  },

  onTTSPlay: (callback: (audioData: ArrayBuffer) => void) => {
    ipcRenderer.on("tts:play", (_event, data) => {
      callback(data);
    });
  },

  onVoiceTranscript: (callback: (transcript: string) => void) => {
    ipcRenderer.on("voice:transcript", (_event, transcript) => {
      callback(transcript);
    });
  },

  onCursorBuddy: (callback: (x: number, y: number) => void) => {
    ipcRenderer.on("overlay:cursor-buddy", (_event, x, y) => {
      callback(x, y);
    });
  },

  onCursorBuddyVisible: (callback: (visible: boolean) => void) => {
    ipcRenderer.on("overlay:cursor-buddy-visible", (_event, visible) => {
      callback(visible);
    });
  },

  onStage: (callback: (data: { stage: string; label: string }) => void) => {
    ipcRenderer.on("companion:stage", (_event, data) => {
      callback(data);
    });
  },

  onConfirmRequest: (callback: (data: { actions: string[] }) => void) => {
    ipcRenderer.on("companion:confirm-request", (_event, data) => {
      callback(data);
    });
  },

  getSettings: () => ipcRenderer.invoke("settings:getAll"),
  setSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke("settings:set", key, value),

  batchSetSettings: (pairs: Array<[string, unknown]>) =>
    ipcRenderer.invoke("settings:batchSet", pairs),

  sendQuery: (text: string): Promise<string> =>
    ipcRenderer.invoke("chat:query", text),

  sendAudioRecording: (audioData: ArrayBuffer): Promise<{ transcript?: string; response?: string; error?: string }> =>
    ipcRenderer.invoke("audio:recording-complete", audioData),

  clearHistory: () => ipcRenderer.invoke("companion:clearHistory"),

  cancelQuery: () => ipcRenderer.invoke("companion:cancelQuery"),

  confirmAction: (approved: boolean) =>
    ipcRenderer.invoke("companion:confirmAction", approved),

  openExternal: (url: string) => {
    ipcRenderer.invoke("shell:openExternal", url);
  },

  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
});
