import { TranscriptionProvider } from "./interface";
import { pcmToWav } from "./wav";
import { fetchWithTimeout } from "../ai-provider";

/**
 * OpenAI Whisper API transcription.
 * Sends audio as a file to the /v1/audio/transcriptions endpoint.
 */
export class OpenAITranscriptionProvider implements TranscriptionProvider {
  private apiKey: string;
  private audioChunks: Buffer[] = [];
  private partialCallback: ((text: string) => void) | null = null;
  private finalCallback: ((text: string) => void) | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async start(): Promise<void> {
    this.audioChunks = [];
  }

  sendAudio(chunk: Buffer): void {
    this.audioChunks.push(chunk);
  }

  async stop(): Promise<string> {
    if (this.audioChunks.length === 0) return "";

    const audioBuffer = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    // Build WAV header for raw PCM16 mono 16kHz
    const wavBuffer = pcmToWav(audioBuffer, 16000);

    // Create form data manually for Node.js fetch
    const boundary = "----ClickyBoundary" + Date.now();
    const header = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="audio.wav"',
      "Content-Type: audio/wav",
      "",
      "",
    ].join("\r\n");
    const modelPart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="model"',
      "",
      "whisper-1",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const body = Buffer.concat([
      Buffer.from(header),
      wavBuffer,
      Buffer.from("\r\n" + modelPart),
    ]);

    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Whisper error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { text: string };
    this.finalCallback?.(data.text);
    return data.text;
  }

  onPartialTranscript(callback: (text: string) => void): void {
    this.partialCallback = callback;
  }

  onFinalTranscript(callback: (text: string) => void): void {
    this.finalCallback = callback;
  }
}
