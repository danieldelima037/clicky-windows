import { TTSProvider } from "./interface";
import { exec } from "child_process";

export class LocalTTS implements TTSProvider {
  private currentProcess: ReturnType<typeof exec> | null = null;

  async speak(text: string): Promise<void> {
    this.stop();

    // Using powershell -Command - allows reading from stdin via [Console]::In.ReadToEnd()
    const psScript = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $text = [Console]::In.ReadToEnd();
      if ($text) { $synth.Speak($text) }
    `.replace(/\n/g, " ").trim();

    return new Promise((resolve, reject) => {
      const child = exec(`powershell -Command "${psScript}"`, (error) => {
        if (error && !error.killed) {
          reject(error);
        } else {
          resolve();
        }
      });
      this.currentProcess = child;
      if (child.stdin) {
        child.stdin.write(text);
        child.stdin.end();
      }
    });
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }
}
