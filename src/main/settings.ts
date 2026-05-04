import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

interface SettingsSchema {
  // API Keys (BYOK)
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
  // Additional providers
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

  // Optional proxy (for non-BYOK / org deployments)
  proxyUrl: string;
  useProxy: boolean;

  // Transcription
  transcriptionProvider: "assemblyai" | "openai" | "whisper-local";

  // TTS
  ttsEnabled: boolean;
  ttsProvider: "elevenlabs" | "openai" | "local";
  elevenlabsVoiceId: string;
  openaiTtsVoice: string;

  // Hotkey
  pushToTalkHotkey: string;

  // AI Provider
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

  // UI
  alwaysOnTop: boolean;
  cursorBuddyEnabled: boolean;

  // HIPAA
  hipaaMode: boolean;
}

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
  aiProvider: "anthropic",
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
  togetherModel: "Qwen/Qwen2-VL-72B-Instruct",
  cerebrasModel: "Qwen/Qwen2-VL-72B-Instruct",
  fireworksModel: "Qwen/Qwen2-VL-72B-Instruct",
  deepinfraModel: "meta-llama/Llama-3.2-90B-Vision-Instruct",
  basetenModel: "llama-3.2-90b-vision",
  veniceModel: "llama-3.3-70b",
  nebiusModel: "Qwen/Qwen2-VL-72B-Instruct",
  moonshotModel: "kimi-k2",
  customModel: "",
  customBaseUrl: "",
  hipaaMode: false,
};

/**
 * Simple JSON file settings store. Avoids electron-store ESM issues.
 */
export class SettingsStore {
  private data: SettingsSchema;
  private filePath: string;

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
        this.data = { ...defaults, ...parsed };
      }
    } catch {
      // Use defaults on any read error
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
    this.save();
  }

  getAll(): SettingsSchema {
    return { ...this.data };
  }

  isConfigured(): boolean {
    if (this.get("useProxy") && this.get("proxyUrl")) {
      return true;
    }
    // Check if the selected provider has its API key configured
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

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch {
      // Silent fail on write error
    }
  }
}
