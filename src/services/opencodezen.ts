import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class OpenCodeZenService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "https://opencode.ai/zen/v1",
      apiKeySetting: "opencodeZenApiKey",
      modelSetting: "opencodeZenModel",
      providerLabel: "OpenCode Zen",
      useRefinementBaseUrl: "https://opencode.ai/zen/v1",
    });
  }
}
