import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface SettingsSchema {
  anthropicApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  nvidiaApiKey: string;
  assemblyaiApiKey: string;
  elevenlabsApiKey: string;
  groqApiKey: string;
  geminiApiKey: string;
  deepseekApiKey: string;
  ollamaApiKey: string;
  lmstudioApiKey: string;
  opencodeZenApiKey: string;
  azureApiKey: string;
  huggingfaceApiKey: string;
  togetherApiKey: string;
  cerebrasApiKey: string;
  fireworksApiKey: string;
  deepinfraApiKey: string;
  basetenApiKey: string;
  veniceApiKey: string;
  nebiusApiKey: string;
  moonshotApiKey: string;
  customApiKey: string;

  proxyUrl: string;
  useProxy: boolean;

  transcriptionProvider: "assemblyai" | "openai" | "whisper-local";

  ttsEnabled: boolean;
  ttsProvider: "elevenlabs" | "openai" | "local";
  elevenlabsVoiceId: string;
  openaiTtsVoice: string;

  pushToTalkHotkey: string;

  aiProvider: "anthropic" | "openai" | "openrouter" | "nvidia" | "groq" | "gemini" | "deepseek" | "ollama" | "lmstudio" | "opencodezen" | "azure" | "huggingface" | "together" | "cerebras" | "fireworks" | "deepinfra" | "baseten" | "venice" | "nebius" | "moonshot" | "custom";
  claudeModel: string;
  openaiModel: string;
  openrouterModel: string;
  nvidiaModel: string;
  groqModel: string;
  geminiModel: string;
  deepseekModel: string;
  ollamaModel: string;
  lmstudioModel: string;
  opencodeZenModel: string;
  azureModel: string;
  huggingfaceModel: string;
  togetherModel: string;
  cerebrasModel: string;
  fireworksModel: string;
  deepinfraModel: string;
  basetenModel: string;
  veniceModel: string;
  nebiusModel: string;
  moonshotModel: string;
  customModel: string;
  customBaseUrl: string;

  alwaysOnTop: boolean;
  cursorBuddyEnabled: boolean;

  hipaaMode: boolean;

  azureResourceName: string;
}

const API_KEY_PATTERN = /ApiKey$/;

const defaults: SettingsSchema = {
  anthropicApiKey: "",
  openaiApiKey: "",
  openrouterApiKey: "",
  nvidiaApiKey: "",
  assemblyaiApiKey: "",
  elevenlabsApiKey: "",
  groqApiKey: "",
  geminiApiKey: "",
  deepseekApiKey: "",
  ollamaApiKey: "",
  lmstudioApiKey: "",
  opencodeZenApiKey: "",
  azureApiKey: "",
  huggingfaceApiKey: "",
  togetherApiKey: "",
  cerebrasApiKey: "",
  fireworksApiKey: "",
  deepinfraApiKey: "",
  basetenApiKey: "",
  veniceApiKey: "",
  nebiusApiKey: "",
  moonshotApiKey: "",
  customApiKey: "",
  proxyUrl: "",
  useProxy: false,
  transcriptionProvider: "assemblyai",
  ttsEnabled: true,
  ttsProvider: "local",
  elevenlabsVoiceId: "kPzsL2i3teMYv0FxEYQ6",
  openaiTtsVoice: "alloy",
  pushToTalkHotkey: "Ctrl+Shift",
  alwaysOnTop: false,
  cursorBuddyEnabled: true,
  aiProvider: "nvidia",
  claudeModel: "claude-sonnet-4-5-20250929",
  openaiModel: "gpt-4o",
  openrouterModel: "anthropic/claude-sonnet-4-5",
  nvidiaModel: "meta/llama-3.2-90b-vision-instruct",
  groqModel: "llama-3.2-90b-vision-instruct",
  geminiModel: "gemini-2.5-flash-preview-05-20",
  deepseekModel: "deepseek-chat",
  ollamaModel: "llama3.2-vision",
  lmstudioModel: "llama3.2-vision",
  opencodeZenModel: "minimax-m2.5-free",
  azureModel: "gpt-4o",
  huggingfaceModel: "Qwen/Qwen2-VL-72B-Instruct",
  togetherModel: "togethercomputer/Qwen2-VL-72B-Instruct",
  cerebrasModel: "llama3.3-70b",
  fireworksModel: "accounts/fireworks/models/qwen2-vl-72b-instruct",
  deepinfraModel: "meta-llama/Llama-3.2-90B-Vision-Instruct",
  basetenModel: "llama-3.2-90b-vision",
  veniceModel: "llama-3.3-70b",
  nebiusModel: "Qwen2-VL-72B-Instruct",
  moonshotModel: "kimi-k2",
  customModel: "",
  customBaseUrl: "",
  hipaaMode: false,
  azureResourceName: "",
};

function encryptValue(plaintext: string): string {
  if (!plaintext) return "";
  const key = crypto.scryptSync("clicky-windows-settings", "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return "enc:" + iv.toString("hex") + ":" + encrypted;
}

function decryptValue(stored: string): string {
  if (!stored || !stored.startsWith("enc:")) return stored;
  try {
    const parts = stored.split(":");
    if (parts.length !== 3) return stored;
    const key = crypto.scryptSync("clicky-windows-settings", "salt", 32);
    const iv = Buffer.from(parts[1], "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(parts[2], "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.warn("[Clicky] Failed to decrypt setting, returning raw value:", err instanceof Error ? err.message : err);
    return stored;
  }
}

export class SettingsStore {
  private data: SettingsSchema;
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor() {
    const userDataPath = app.isReady()
      ? app.getPath("userData")
      : path.join(
          process.env.APPDATA || process.env.HOME || ".",
          "clicky-windows"
        );

    this.filePath = path.join(userDataPath, "settings.json");
    this.data = { ...defaults };

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<SettingsSchema>;
        const decrypted: Partial<SettingsSchema> = {};
        for (const [key, val] of Object.entries(parsed)) {
          if (API_KEY_PATTERN.test(key) && typeof val === "string") {
            (decrypted as Record<string, unknown>)[key] = decryptValue(val);
          } else {
            (decrypted as Record<string, unknown>)[key] = val;
          }
        }
        this.data = { ...defaults, ...decrypted };
      }
    } catch (err) {
      console.warn("[Clicky] Failed to load settings, using defaults:", err instanceof Error ? err.message : err);
    }
  }

  get<K extends keyof SettingsSchema>(
    key: K,
    fallback?: SettingsSchema[K]
  ): SettingsSchema[K] {
    const val = this.data[key];
    if (val === undefined && fallback !== undefined) return fallback;
    return val;
  }

  set<K extends keyof SettingsSchema>(
    key: K,
    value: SettingsSchema[K]
  ): void {
    this.data[key] = value;
    this.scheduleSave();
  }

  getAll(): SettingsSchema {
    return { ...this.data };
  }

  isConfigured(): boolean {
    if (this.get("useProxy") && this.get("proxyUrl")) {
      return true;
    }
    const provider = this.get("aiProvider");
    const keyMap: Record<string, keyof SettingsSchema> = {
      anthropic: "anthropicApiKey",
      openai: "openaiApiKey",
      openrouter: "openrouterApiKey",
      nvidia: "nvidiaApiKey",
      groq: "groqApiKey",
      gemini: "geminiApiKey",
      deepseek: "deepseekApiKey",
      ollama: "ollamaApiKey",
      lmstudio: "lmstudioApiKey",
      opencodezen: "opencodeZenApiKey",
      azure: "azureApiKey",
      huggingface: "huggingfaceApiKey",
      together: "togetherApiKey",
      cerebras: "cerebrasApiKey",
      fireworks: "fireworksApiKey",
      deepinfra: "deepinfraApiKey",
      baseten: "basetenApiKey",
      venice: "veniceApiKey",
      nebius: "nebiusApiKey",
      moonshot: "moonshotApiKey",
      custom: "customApiKey",
    };
    const keyField = keyMap[provider] || "anthropicApiKey";
    return !!this.get(keyField);
  }

  isHipaaMode(): boolean {
    return this.get("hipaaMode");
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.dirty = false;
        this.flushSave();
      }
    }, 100);
  }

  private flushSave(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const toSave: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(this.data)) {
        if (API_KEY_PATTERN.test(key) && typeof val === "string" && val) {
          toSave[key] = encryptValue(val);
        } else {
          toSave[key] = val;
        }
      }
      fs.writeFileSync(this.filePath, JSON.stringify(toSave, null, 2));
    } catch (err) {
      console.error("[Clicky] Failed to save settings:", err instanceof Error ? err.message : err);
    }
  }
}
