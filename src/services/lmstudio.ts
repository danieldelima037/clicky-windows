import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class LMStudioService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "http://localhost:1234/v1",
      apiKeySetting: "lmstudioApiKey",
      modelSetting: "lmstudioModel",
      providerLabel: "LM Studio",
    });
  }
}
