import { SettingsStore } from "../main/settings";
import { OpenAICompatibleProvider } from "./openai-compatible";

export class NvidiaChatService extends OpenAICompatibleProvider {
  constructor(settings: SettingsStore) {
    super(settings, {
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKeySetting: "nvidiaApiKey",
      modelSetting: "nvidiaModel",
      providerLabel: "NVIDIA",
      extraBody: { stream: false },
    });
  }
}
