import { TTSProvider } from "./interface";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fetchWithTimeout } from "../ai-provider";

function buildEncodedCommand(psScript: string): string {
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  return `powershell -EncodedCommand ${encoded}`;
}

export class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private abortController: AbortController | null = null;
  private currentProcess: ReturnType<typeof exec> | null = null;

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
  }

  async speak(text: string): Promise<void> {
    this.stop();
    this.abortController = new AbortController();

    const response = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: this.abortController.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    const tmpFile = path.join(os.tmpdir(), `clicky-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, audioBuffer);

    const estimatedSeconds = Math.ceil(audioBuffer.length / 16000) + 1;

    return new Promise((resolve, reject) => {
      const psScript = [
        "Add-Type -AssemblyName presentationCore",
        "$p = New-Object System.Windows.Media.MediaPlayer",
        `$p.Open([Uri]'${tmpFile.replace(/'/g, "''")}')`,
        "$p.Play()",
        `Start-Sleep -Seconds ${estimatedSeconds}`,
        "$p.Close()",
      ].join("; ");
      const cmd = buildEncodedCommand(psScript);

      this.currentProcess = exec(cmd, { timeout: estimatedSeconds * 1000 + 5000 }, (error) => {
        this.currentProcess = null;
        try { fs.unlinkSync(tmpFile); } catch (e) { console.warn("[Clicky] TTS temp file cleanup failed:", e instanceof Error ? e.message : e); }
        if (error && !error.killed) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }
}
