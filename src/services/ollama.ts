import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class OllamaService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "http://localhost:11434/v1",
      apiKeySetting: "ollamaApiKey",
      modelSetting: "ollamaModel",
      providerLabel: "Ollama",
    });
  }
}
