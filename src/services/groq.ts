import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class GroqService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeySetting: "groqApiKey",
      modelSetting: "groqModel",
      providerLabel: "Groq",
    });
  }
}
