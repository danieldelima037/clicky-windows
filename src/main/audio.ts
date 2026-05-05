import { ipcMain, BrowserWindow } from "electron";
import { SettingsStore } from "./settings";
import { CompanionManager } from "./companion";
import { WhisperLocalProvider } from "../services/transcription/whisper-local";
import { pcmToWav } from "../services/transcription/wav";
import { AssemblyAIProvider } from "../services/transcription/assemblyai";

const CLOUD_TRANSCRIPTION_PROVIDERS = new Set(["assemblyai", "openai"]);

export class AudioCapture {
  private settings: SettingsStore;
  private companion: CompanionManager | null = null;

  constructor(settings: SettingsStore) {
    this.settings = settings;
    this.setupIPC();
  }

  setCompanion(companion: CompanionManager): void {
    this.companion = companion;
  }

  private setupIPC(): void {
    ipcMain.handle(
      "audio:recording-complete",
      async (_event, audioData: ArrayBuffer) => {
        try {
          const transcript = await this.transcribe(Buffer.from(audioData));
          if (!transcript || !transcript.trim()) {
            return { error: "No speech detected" };
          }

          console.log("Transcript received, length:", transcript.length);

          this.notifyChat("voice:transcript", transcript);

          if (this.companion) {
            const response = await this.companion.processQuery(transcript);
            return { transcript, response };
          }

          return { transcript, error: "Companion not ready" };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("Voice pipeline error:", msg);
          return { error: msg };
        }
      }
    );
  }

  private async transcribe(pcmBuffer: Buffer): Promise<string> {
    const MAX_PCM_BYTES = 60 * 32_000;
    if (pcmBuffer.length > MAX_PCM_BYTES) {
      pcmBuffer = pcmBuffer.subarray(0, MAX_PCM_BYTES);
    }

    const provider = this.settings.get("transcriptionProvider");
    const hipaaMode = this.settings.get("hipaaMode");

    if (hipaaMode && CLOUD_TRANSCRIPTION_PROVIDERS.has(provider)) {
      throw new Error(
        `HIPAA mode is enabled — cannot use cloud transcription provider "${provider}". Switch to whisper-local or disable HIPAA mode.`
      );
    }

    if (provider === "whisper-local") {
      const local = new WhisperLocalProvider();
      await local.start();
      local.sendAudio(pcmBuffer);
      return local.stop();
    }

    if (provider === "assemblyai") {
      const assemblyaiKey = this.settings.get("assemblyaiApiKey");
      if (!assemblyaiKey) {
        throw new Error("AssemblyAI API key not configured. Set it in Settings.");
      }
      const aai = new AssemblyAIProvider(assemblyaiKey);
      await aai.start();
      aai.sendAudio(pcmBuffer);
      return aai.stop();
    }

    const openaiKey = this.settings.get("openaiApiKey");
    if (openaiKey) {
      return this.transcribeWhisper(pcmBuffer, openaiKey);
    }

    throw new Error(
      "No transcription provider configured. Set transcriptionProvider to 'whisper-local' or add an API key."
    );
  }

  private async transcribeWhisper(
    pcmBuffer: Buffer,
    apiKey: string
  ): Promise<string> {
    const wavBuffer = pcmToWav(pcmBuffer);
    const boundary = "----ClickyAudio" + Date.now();

    const parts: Buffer[] = [];
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      )
    );
    parts.push(wavBuffer);
    parts.push(Buffer.from("\r\n"));
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      )
    );
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { text: string };
    return data.text;
  }

  private notifyChat(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
}
