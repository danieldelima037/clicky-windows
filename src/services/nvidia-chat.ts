import { SettingsStore } from "../main/settings";
import { ScreenshotResult } from "../main/screenshot";

interface ChatQueryParams {
  transcript: string;
  screenshots: ScreenshotResult[];
  cursorPosition: { x: number; y: number };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

interface ChatResponse {
  text: string;
}

const SYSTEM_PROMPT = `You are Clicky, a helpful AI screen companion. You can see the user's screen and hear their voice.

When you want to point at something on the user's screen, embed a coordinate tag in your response like this:
[POINT:x,y:label:screenN]

Where x,y are pixel coordinates on the screen, label is a short description, and N is the screen/display index (0-based).

Be concise and helpful. You're having a real-time conversation — keep responses short and actionable.`;

/**
 * NVIDIA NIM chat service — OpenAI-compatible API for NVIDIA hosted models.
 * Supports vision models like LLaMA 3.2 Vision, Nemotron, and more.
 * Free tier available at https://build.nvidia.com/
 */
export class NvidiaChatService {
  private settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.settings = settings;
  }

  async query(params: ChatQueryParams): Promise<ChatResponse> {
    const apiKey = this.settings.get("nvidiaApiKey");
    const model = this.settings.get("nvidiaModel");

    // Build user message content with images (OpenAI vision format)
    const userContent: Array<Record<string, unknown>> = [];

    for (const screenshot of params.screenshots) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${screenshot.data}`,
        },
      });
    }

    userContent.push({
      type: "text",
      text: [
        `User says: "${params.transcript}"`,
        `Cursor position: (${params.cursorPosition.x}, ${params.cursorPosition.y})`,
        `Screens: ${params.screenshots.map((s, i) =>
          `screen${i} ${s.bounds.width}x${s.bounds.height} at (${s.bounds.x},${s.bounds.y})`
        ).join(", ")}`,
      ].join("\n"),
    });

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    for (const entry of params.conversationHistory) {
      if (entry.role === "user" && entry.content === params.transcript) {
        messages.push({ role: "user", content: userContent });
      } else {
        messages.push({ role: entry.role, content: entry.content });
      }
    }

    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages,
          stream: false,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`NVIDIA API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices[0]?.message?.content || "";
    return { text };
  }
}
