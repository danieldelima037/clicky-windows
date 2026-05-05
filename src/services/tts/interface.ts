import { SettingsStore } from "../../main/settings";
import { ElevenLabsTTS } from "./elevenlabs";
import { OpenAITTS } from "./openai";
import { LocalTTS } from "./local";

export interface TTSProvider {
  speak(text: string): Promise<void>;
  stop(): void;
}

export function createTTSProvider(settings: SettingsStore): TTSProvider {
  const provider = settings.get("ttsProvider");

  switch (provider) {
    case "elevenlabs":
      return new ElevenLabsTTS(
        settings.get("elevenlabsApiKey"),
        settings.get("elevenlabsVoiceId")
      );
    case "openai":
      return new OpenAITTS(
        settings.get("openaiApiKey"),
        settings.get("openaiTtsVoice")
      );
    case "local":
      return new LocalTTS();
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}
