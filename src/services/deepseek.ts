import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class DeepSeekService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "https://api.deepseek.com/v1",
      apiKeySetting: "deepseekApiKey",
      modelSetting: "deepseekModel",
      providerLabel: "DeepSeek",
    });
  }
}
