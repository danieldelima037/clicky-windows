import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class OpenAIChatService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "https://api.openai.com/v1",
      apiKeySetting: "openaiApiKey",
      modelSetting: "openaiModel",
      providerLabel: "OpenAI",
      extraBody: { max_completion_tokens: 1024 },
    });
  }
}
