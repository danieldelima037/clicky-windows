import { BrowserWindow, ipcMain } from "electron";
import { ScreenCapture, ScreenshotResult, cropScreenshotRegion } from "./screenshot";
import { SettingsStore } from "./settings";
import { AIProvider } from "../services/ai-provider";
import { ClaudeService } from "../services/claude";
import { OpenAIChatService } from "../services/openai-chat";
import { OpenRouterChatService } from "../services/openrouter-chat";
import { NvidiaChatService } from "../services/nvidia-chat";
import { GroqService } from "../services/groq";
import { GeminiService } from "../services/gemini";
import { DeepSeekService } from "../services/deepseek";
import { OllamaService } from "../services/ollama";
import { LMStudioService } from "../services/lmstudio";
import { OpenCodeZenService } from "../services/opencodezen";
import { GenericAIProvider } from "../services/generic";
import { TTSProvider, createTTSProvider } from "../services/tts/interface";
import { mouse, Point, keyboard } from "@nut-tree-fork/nut-js";

interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

const MAX_CONVERSATION_HISTORY = 10;

const CLOUD_PROVIDERS = new Set([
  "openai", "openrouter", "nvidia", "groq", "gemini",
  "deepseek", "anthropic", "together", "cerebras",
  "fireworks", "deepinfra", "baseten", "venice",
  "nebius", "moonshot", "huggingface", "opencodezen",
]);

const CLOUD_TTS_PROVIDERS = new Set(["elevenlabs", "openai"]);

const CLOUD_TRANSCRIPTION_PROVIDERS = new Set(["assemblyai", "openai"]);

const TAG_REGEX = /\[(?:POINT|CLICK|TYPE)(?:_[A-Z]+)?:[^\]]+\]/g;

const GENERIC_PROVIDERS = [
  "azure", "huggingface", "together", "cerebras", "fireworks",
  "deepinfra", "baseten", "venice", "nebius", "moonshot", "custom",
];

export class CompanionManager {
  private settings: SettingsStore;
  private screenCapture: ScreenCapture;
  private conversationHistory: ConversationEntry[] = [];
  private overlayWindows: BrowserWindow[] = [];
  private cachedProvider: AIProvider | null = null;
  private cachedProviderName: string = "";
  private activeTTS: TTSProvider | null = null;
  private queryLock: Promise<void> = Promise.resolve();
  private abortController: AbortController | null = null;
  private autoExecuteClickType: boolean = true;

  constructor(settings: SettingsStore, overlayWindows: BrowserWindow[]) {
    this.settings = settings;
    this.screenCapture = new ScreenCapture();
    this.overlayWindows = overlayWindows;
    this.autoExecuteClickType = true;
  }

  private stripTags(text: string): string {
    return text.replace(TAG_REGEX, "").trim();
  }

  private async enqueueQuery(fn: () => Promise<string>): Promise<string> {
    const prev = this.queryLock;
    let resolveLock!: () => void;
    this.queryLock = new Promise<void>((r) => { resolveLock = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolveLock();
    }
  }

  cancelQuery(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  updateOverlayWindows(windows: BrowserWindow[]): void {
    this.overlayWindows = windows;
  }

  async processQuery(transcript: string): Promise<string> {
    return this.enqueueQuery(() => this._processQuery(transcript));
  }

  private async _processQuery(transcript: string): Promise<string> {
    this.abortController = new AbortController();
    try {
      const hipaaMode = this.settings.get("hipaaMode");
      const provider = this.settings.get("aiProvider");
      if (hipaaMode && CLOUD_PROVIDERS.has(provider)) {
        throw new Error(
          `HIPAA mode is enabled — cannot use cloud provider "${provider}". Switch to a local provider or disable HIPAA mode.`
        );
      }

      const ttsProvider = this.settings.get("ttsProvider");
      if (hipaaMode && CLOUD_TTS_PROVIDERS.has(ttsProvider)) {
        throw new Error(
          `HIPAA mode is enabled — cannot use cloud TTS provider "${ttsProvider}". Switch to local TTS or disable HIPAA mode.`
        );
      }

      const transcriptionProvider = this.settings.get("transcriptionProvider");
      if (hipaaMode && CLOUD_TRANSCRIPTION_PROVIDERS.has(transcriptionProvider)) {
        throw new Error(
          `HIPAA mode is enabled — cannot use cloud transcription "${transcriptionProvider}". Switch to whisper-local or disable HIPAA mode.`
        );
      }

      this.broadcastStage("capturing", "Reading screen...");
      const screenshots = await this.screenCapture.captureAllScreens();
      const cursorPos = this.screenCapture.getCursorPosition();

      this.conversationHistory.push({ role: "user", content: transcript });

      const cleanHistory = this.conversationHistory.map((entry) => ({
        ...entry,
        content: this.stripTags(entry.content),
      }));

      this.broadcastStage("querying", "Analyzing...");
      const ai = this.getAIProvider();
      const response = await ai.query({
        transcript,
        screenshots,
        cursorPosition: cursorPos,
        conversationHistory: cleanHistory,
        signal: this.abortController.signal,
      });

      this.conversationHistory.push({ role: "assistant", content: response.text });

      if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY * 2) {
        this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_HISTORY * 2);
      }

      const rawTags = this.parseRawPointTags(response.text);
      console.log("[Clicky] AI response:", response.text);
      console.log("[Clicky] Raw POINT tags:", JSON.stringify(rawTags));

      let refinedTags = rawTags;
      if (rawTags.length > 0 && ai.refinePoint) {
        this.broadcastStage("refining", "Refining points...");
        refinedTags = await Promise.all(
          rawTags.map(async (tag) => {
            const shot = screenshots[tag.screen] || screenshots[0];
            if (!shot) return tag;
            try {
              const crop = cropScreenshotRegion(shot, tag.x, tag.y, 300);
              const refined = await ai.refinePoint!(
                crop.data,
                crop.claudeSize.w,
                crop.claudeSize.h,
                tag.label
              );
              if (refined) {
                const imgX = crop.origin.x + refined.x / crop.pxPerImageDim;
                const imgY = crop.origin.y + refined.y / crop.pxPerImageDim;
                console.log(
                  `[Clicky] Refined "${tag.label}": (${tag.x},${tag.y}) → (${Math.round(imgX)},${Math.round(imgY)})`
                );
                return { ...tag, x: Math.round(imgX), y: Math.round(imgY) };
              }
            } catch (err) {
              console.warn(
                `[Clicky] Refinement failed for "${tag.label}":`,
                err instanceof Error ? err.message : err
              );
            }
            return tag;
          })
        );
      }

      const pointTags = refinedTags.map((tag) => {
        const shot = screenshots[tag.screen] || screenshots[0];
        if (!shot) return tag;

        if (tag.isPct) {
          return {
            ...tag,
            x: Math.round((tag.x / 100) * shot.bounds.width),
            y: Math.round((tag.y / 100) * shot.bounds.height),
          };
        }

        const scaleX = shot.bounds.width / shot.imageDimensions.width;
        const scaleY = shot.bounds.height / shot.imageDimensions.height;
        return {
          ...tag,
          x: Math.round(tag.x * scaleX),
          y: Math.round(tag.y * scaleY),
        };
      });

      console.log("[Clicky] Final POINT tags:", JSON.stringify(pointTags));
      if (pointTags.length > 0 && this.overlayWindows.length > 0) {
        const byScreen = new Map<number, typeof pointTags>();
        for (const tag of pointTags) {
          const list = byScreen.get(tag.screen) || [];
          list.push(tag);
          byScreen.set(tag.screen, list);
        }
        for (const [screenIdx, tags] of byScreen) {
          if (screenIdx < 0 || screenIdx >= this.overlayWindows.length) {
            console.warn(
              `[Clicky] POINT tag screen=${screenIdx} out of range (${this.overlayWindows.length} overlays); routing to primary.`
            );
          }
          const win = this.overlayWindows[screenIdx] || this.overlayWindows[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send("overlay:point", tags);
          }
        }
      }

      const clickTags = this.parseClickTags(response.text);
      const typeTags = this.parseTypeTags(response.text);

      if ((clickTags.length > 0 || typeTags.length > 0) && !this.autoExecuteClickType) {
        this.broadcastStage("confirm", "Confirming actions...");
        const confirmed = await this.requestClickTypeConfirmation(clickTags, typeTags, screenshots);
        if (!confirmed) {
          console.log("[Clicky] User declined CLICK/TYPE actions");
        }
      } else {
        for (const tag of clickTags) {
          const shot = screenshots[tag.screen] || screenshots[0];
          if (shot) {
            const globalCoords = this.tagToGlobalCoords(tag, shot);
            console.log(`[Clicky] Clicking at ${globalCoords.x}, ${globalCoords.y}`);
            try {
              await mouse.setPosition(new Point(globalCoords.x, globalCoords.y));
              await mouse.leftClick();
            } catch (e) {
              console.error("Click error:", e);
            }
          }
        }

        for (const tag of typeTags) {
          console.log(`[Clicky] Typing text: ${tag.text}`);
          try {
            await keyboard.type(tag.text);
          } catch (e) {
            console.error("Type error:", e);
          }
        }
      }

      const spokenText = this.stripTags(response.text);
      const ttsOn = this.settings.get("ttsEnabled");
      if (ttsOn && spokenText) {
        this.broadcastStage("speaking", "Speaking...");
        try {
          if (this.activeTTS) {
            this.activeTTS.stop();
          }
          const tts = createTTSProvider(this.settings);
          this.activeTTS = tts;
          tts.speak(spokenText).catch((err) => {
            console.warn("TTS failed (non-fatal):", err.message);
          });
        } catch (err: unknown) {
          console.warn("TTS provider creation failed:", err instanceof Error ? err.message : err);
        }
      }

      return response.text;
    } finally {
      this.abortController = null;
      this.broadcastStage("done", "");
    }
  }

  private tagToGlobalCoords(
    tag: { x: number; y: number; screen: number; isPct?: boolean },
    shot: ScreenshotResult
  ): { x: number; y: number } {
    if (tag.isPct) {
      return {
        x: shot.bounds.x + Math.round((tag.x / 100) * shot.bounds.width),
        y: shot.bounds.y + Math.round((tag.y / 100) * shot.bounds.height),
      };
    }
    const scaleX = shot.bounds.width / shot.imageDimensions.width;
    const scaleY = shot.bounds.height / shot.imageDimensions.height;
    return {
      x: shot.bounds.x + Math.round(tag.x * scaleX),
      y: shot.bounds.y + Math.round(tag.y * scaleY),
    };
  }

  private async requestClickTypeConfirmation(
    clickTags: Array<{ x: number; y: number; screen: number; isPct?: boolean }>,
    typeTags: Array<{ text: string }>,
    screenshots: ScreenshotResult[]
  ): Promise<boolean> {
    const actions: string[] = [];
    for (const tag of clickTags) {
      const shot = screenshots[tag.screen] || screenshots[0];
      if (shot) {
        const coords = this.tagToGlobalCoords(tag, shot);
        actions.push(`Click at (${coords.x}, ${coords.y}) on screen ${tag.screen}`);
      }
    }
    for (const tag of typeTags) {
      actions.push(`Type: "${tag.text}"`);
    }
    this.broadcastStage("confirm", `Confirm: ${actions.join("; ")}?`);
    return new Promise<boolean>((resolve) => {
      ipcMain.handleOnce("companion:confirmAction", (_event, approved: boolean) => {
        resolve(approved);
      });
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("companion:confirm-request", { actions });
        }
      }
    });
  }

  private getAIProvider(): AIProvider {
    const provider = this.settings.get("aiProvider");
    if (this.cachedProvider && this.cachedProviderName === provider) {
      return this.cachedProvider;
    }

    let instance: AIProvider;

    const providerMap: Record<string, () => AIProvider> = {
      openai: () => new OpenAIChatService(this.settings),
      openrouter: () => new OpenRouterChatService(this.settings),
      nvidia: () => new NvidiaChatService(this.settings),
      groq: () => new GroqService(this.settings),
      gemini: () => new GeminiService(this.settings),
      deepseek: () => new DeepSeekService(this.settings),
      ollama: () => new OllamaService(this.settings),
      lmstudio: () => new LMStudioService(this.settings),
      opencodezen: () => new OpenCodeZenService(this.settings),
    };

    if (providerMap[provider]) {
      instance = providerMap[provider]();
    } else if (GENERIC_PROVIDERS.includes(provider)) {
      instance = new GenericAIProvider(this.settings, provider);
    } else {
      instance = new ClaudeService(this.settings);
    }

    this.cachedProvider = instance;
    this.cachedProviderName = provider;
    return instance;
  }

  private broadcastStage(stage: string, label: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("companion:stage", { stage, label });
      }
    }
  }

  private parseRawPointTags(
    text: string
  ): Array<{ x: number; y: number; label: string; screen: number; isPct?: boolean }> {
    const regex = /\[POINT(_PCT)?:([\d.]+),([\d.]+):([^:]+):screen(\d+)\]/gi;
    const tags: Array<{ x: number; y: number; label: string; screen: number; isPct?: boolean }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      tags.push({
        isPct: !!match[1],
        x: parseFloat(match[2]),
        y: parseFloat(match[3]),
        label: match[4],
        screen: parseInt(match[5], 10),
      });
    }

    return tags;
  }

  private parseClickTags(
    text: string
  ): Array<{ x: number; y: number; screen: number; isPct?: boolean }> {
    const regex = /\[CLICK(_PCT)?:([\d.]+),([\d.]+):screen(\d+)\]/gi;
    const tags: Array<{ x: number; y: number; screen: number; isPct?: boolean }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      tags.push({
        isPct: !!match[1],
        x: parseFloat(match[2]),
        y: parseFloat(match[3]),
        screen: parseInt(match[4], 10),
      });
    }

    return tags;
  }

  private parseTypeTags(text: string): Array<{ text: string }> {
    const regex = /\[TYPE:([^\]]+)\]/g;
    const tags: Array<{ text: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      tags.push({ text: match[1] });
    }

    return tags;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
