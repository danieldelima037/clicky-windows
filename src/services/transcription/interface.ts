import { SettingsStore } from "../../main/settings";
import { AssemblyAIProvider } from "./assemblyai";
import { OpenAITranscriptionProvider } from "./openai";
import { WhisperLocalProvider } from "./whisper-local";

export interface TranscriptionProvider {
  start(): Promise<void>;
  sendAudio(chunk: Buffer): void;
  stop(): Promise<string>;
  onPartialTranscript(callback: (text: string) => void): void;
  onFinalTranscript(callback: (text: string) => void): void;
}

export function createTranscriptionProvider(
  settings: SettingsStore
): TranscriptionProvider {
  const provider = settings.get("transcriptionProvider");

  switch (provider) {
    case "assemblyai":
      return new AssemblyAIProvider(settings.get("assemblyaiApiKey"));

    case "openai":
      return new OpenAITranscriptionProvider(settings.get("openaiApiKey"));

    case "whisper-local":
      return new WhisperLocalProvider();

    default:
      throw new Error(`Unknown transcription provider: ${provider}`);
  }
}
