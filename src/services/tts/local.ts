import { TTSProvider } from "./interface";
import { exec } from "child_process";

function buildEncodedCommand(psScript: string): string {
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  return `powershell -EncodedCommand ${encoded}`;
}

export class LocalTTS implements TTSProvider {
  private currentProcess: ReturnType<typeof exec> | null = null;

  async speak(text: string): Promise<void> {
    this.stop();

    const escaped = text.replace(/'/g, "''").replace(/"/g, '`"');
    const psScript = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${escaped}')`;
    const cmd = buildEncodedCommand(psScript);

    return new Promise((resolve, reject) => {
      this.currentProcess = exec(cmd, (error) => {
        this.currentProcess = null;
        if (error) {
          if (error.killed) {
            resolve();
          } else {
            reject(error);
          }
        } else {
          resolve();
        }
      });
    });
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }
}
