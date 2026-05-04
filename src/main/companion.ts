import { BrowserWindow } from "electron";
import { ScreenCapture, ScreenshotResult, cropScreenshotRegion } from "./screenshot";
import { SettingsStore } from "./settings";
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
import {
  TranscriptionProvider,
  createTranscriptionProvider,
} from "../services/transcription/interface";
import { createTTSProvider } from "../services/tts/interface";
import { mouse, Point, keyboard } from "@nut-tree-fork/nut-js";

interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

interface AIProvider {
  query(params: {
    transcript: string;
    screenshots: ScreenshotResult[];
    cursorPosition: { x: number; y: number };
    conversationHistory: ConversationEntry[];
  }): Promise<{ text: string }>;
}

const MAX_CONVERSATION_HISTORY = 10;

/**
 * Central orchestrator — mirrors CompanionManager.swift from macOS version.
 *
 * Flow: voice → screenshot → ai (anthropic, openai, openrouter, or nvidia) → tts → overlay pointing
 */
export class CompanionManager {
  private settings: SettingsStore;
  private screenCapture: ScreenCapture;
  private transcription: TranscriptionProvider;
  private conversationHistory: ConversationEntry[] = [];
  private overlayWindows: BrowserWindow[] = [];

  constructor(settings: SettingsStore, overlayWindows: BrowserWindow[]) {
    this.settings = settings;
    this.screenCapture = new ScreenCapture();
    this.transcription = createTranscriptionProvider(settings);
    this.overlayWindows = overlayWindows;
  }

  private getAIProvider(): AIProvider {
    const provider = this.settings.get("aiProvider");
    if (provider === "openai") {
      return new OpenAIChatService(this.settings);
    }
    if (provider === "openrouter") {
      return new OpenRouterChatService(this.settings);
    }
    if (provider === "nvidia") {
      return new NvidiaChatService(this.settings);
    }
    if (provider === "groq") {
      return new GroqService(this.settings);
    }
    if (provider === "gemini") {
      return new GeminiService(this.settings);
    }
    if (provider === "deepseek") {
      return new DeepSeekService(this.settings);
    }
    if (provider === "ollama") {
      return new OllamaService(this.settings);
    }
    if (provider === "lmstudio") {
      return new LMStudioService(this.settings);
    }
    if (provider === "opencodezen") {
      return new OpenCodeZenService(this.settings);
    }
    // Generic providers (Azure, HuggingFace, Together, Cerebras, Fireworks, DeepInfra, Baseten, Venice, Nebius, Moonshot, Custom)
    if (["azure", "huggingface", "together", "cerebras", "fireworks", "deepinfra", "baseten", "venice", "nebius", "moonshot", "custom"].includes(provider)) {
      return new GenericAIProvider(this.settings, provider);
    }
    return new ClaudeService(this.settings);
  }

  private broadcastStage(stage: string, label: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("companion:stage", { stage, label });
      }
    }
  }

  /**
   * Process a user query: capture screen, send to AI, speak response.
   */
  async processQuery(transcript: string): Promise<string> {
    try {
    // 1. Capture screenshots
    this.broadcastStage("capturing", "Reading screen...");
    const screenshots = await this.screenCapture.captureAllScreens();
    const cursorPos = this.screenCapture.getCursorPosition();

    // 2. Send to AI provider with conversation history
    this.conversationHistory.push({ role: "user", content: transcript });

    this.broadcastStage("querying", "Analyzing...");
    const ai = this.getAIProvider();
    const response = await ai.query({
      transcript,
      screenshots,
      cursorPosition: cursorPos,
      conversationHistory: this.conversationHistory,
    });

    this.conversationHistory.push({ role: "assistant", content: response.text });

    // Trim history
    if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY * 2) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_HISTORY * 2);
    }

    // 3a. Parse raw POINT tags (still in image-pixel space).
    const rawTags = this.parseRawPointTags(response.text);
    console.log("[Clicky] Claude response:", response.text);
    console.log("[Clicky] Raw POINT tags:", JSON.stringify(rawTags));

    // 3b. Second-pass refinement: only Claude for now.
    //     For each tag, crop ~400px around the estimated point and ask the
    //     model to return the precise pixel center. Falls back to the raw
    //     tag if anything goes wrong.
    const aiProviderName = this.settings.get("aiProvider");
    let refinedTags = rawTags;
    if (aiProviderName === "anthropic" && rawTags.length > 0) {
      this.broadcastStage("refining", "Refining points...");
      const claude = new ClaudeService(this.settings);
      refinedTags = await Promise.all(
        rawTags.map(async (tag) => {
          const shot = screenshots[tag.screen] || screenshots[0];
          if (!shot) return tag;
          try {
            // 300 imageDim px — small enough to reduce ambiguity with
            // neighboring similar elements (e.g. like/dislike), large enough
            // to give context. At native DPI this is a much sharper patch
            // than cropping the downsampled pass-1 image.
            const crop = cropScreenshotRegion(shot, tag.x, tag.y, 300);
            const refined = await claude.refinePoint(
              crop.data,
              crop.claudeSize.w,
              crop.claudeSize.h,
              tag.label
            );
            if (refined) {
              // Refined coords live in native crop-pixel space. Map back to
              // imageDimensions (pass-1) space so later scaling to display
              // px works consistently.
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

    // 3c. Scale image-pixel coords to display-pixel coords for the overlay.
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
    console.log("[Clicky] Overlay windows:", this.overlayWindows.length);
    if (pointTags.length > 0 && this.overlayWindows.length > 0) {
      // Route each tag to the overlay for its target display. Coordinates
      // are already in that display's local CSS space (0..bounds.width).
      const byScreen = new Map<number, typeof pointTags>();
      for (const tag of pointTags) {
        const list = byScreen.get(tag.screen) || [];
        list.push(tag);
        byScreen.set(tag.screen, list);
      }
      for (const [screenIdx, tags] of byScreen) {
        if (screenIdx < 0 || screenIdx >= this.overlayWindows.length) {
          console.warn(
            `[Clicky] POINT tag screen=${screenIdx} is out of range (have ${this.overlayWindows.length} overlay windows); routing to primary display.`
          );
        }
        const win = this.overlayWindows[screenIdx] || this.overlayWindows[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send("overlay:point", tags);
        }
      }
    }

    // Execute CLICK tags
    const clickTags = this.parseClickTags(response.text);
    for (const tag of clickTags) {
      const shot = screenshots[tag.screen] || screenshots[0];
      if (shot) {
        let globalX, globalY;
        if (tag.isPct) {
          globalX = shot.bounds.x + Math.round((tag.x / 100) * shot.bounds.width);
          globalY = shot.bounds.y + Math.round((tag.y / 100) * shot.bounds.height);
        } else {
          const scaleX = shot.bounds.width / shot.imageDimensions.width;
          const scaleY = shot.bounds.height / shot.imageDimensions.height;
          globalX = shot.bounds.x + Math.round(tag.x * scaleX);
          globalY = shot.bounds.y + Math.round(tag.y * scaleY);
        }
        console.log(`[Clicky] Clicking at ${globalX}, ${globalY}`);
        try {
          await mouse.setPosition(new Point(globalX, globalY));
          await mouse.leftClick();
        } catch (e) {
          console.error("Click error:", e);
        }
      }
    }

    // Execute TYPE tags
    const typeTags = this.parseTypeTags(response.text);
    for (const tag of typeTags) {
      console.log(`[Clicky] Typing text: ${tag.text}`);
      try {
        await keyboard.type(tag.text);
      } catch (e) {
        console.error("Type error:", e);
      }
    }

    // 4. Speak response (strip tags from spoken text) — non-blocking
    //    Re-read settings each time so chat toggle changes take effect immediately
    const spokenText = response.text
      .replace(/\[POINT:[^\]]+\]/g, "")
      .replace(/\[CLICK:[^\]]+\]/g, "")
      .replace(/\[TYPE:[^\]]+\]/g, "")
      .trim();
    const ttsOn = this.settings.get("ttsEnabled");
    const ttsProv = this.settings.get("ttsProvider");
    if (ttsOn && spokenText) {
      this.broadcastStage("speaking", "Speaking...");
      try {
        const tts = createTTSProvider(this.settings);
        tts.speak(spokenText).catch((err) => {
          console.warn("TTS failed (non-fatal):", err.message);
        });
      } catch (err: unknown) {
        console.warn("TTS provider creation failed:", err instanceof Error ? err.message : err);
      }
    }

    return response.text;
    } finally {
      this.broadcastStage("done", "");
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
