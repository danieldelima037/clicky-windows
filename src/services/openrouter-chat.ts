import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class OpenRouterChatService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeySetting: "openrouterApiKey",
      modelSetting: "openrouterModel",
      providerLabel: "OpenRouter",
      extraHeaders: {
        "HTTP-Referer": "https://github.com/tekram/clicky-windows",
        "X-Title": "Clicky Windows",
      },
    });
  }
}
