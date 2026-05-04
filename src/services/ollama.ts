import { SettingsStore } from "../main/settings";
import { ScreenshotResult } from "../main/screenshot";

interface OllamaQueryParams {
  transcript: string;
  screenshots: ScreenshotResult[];
  cursorPosition: { x: number; y: number };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

interface OllamaResponse {
  text: string;
}

const SYSTEM_PROMPT = `You are Clicky, a helpful AI screen companion. You can see the user's screen via screenshots.

## CRITICAL: Visual pointing protocol

You POINT at things on the user's screen with an animated cursor overlay. Whenever the user asks "where", "how do I", "show me", "click", "find", or otherwise asks for visual guidance, you MUST emit at least one POINT tag for every UI element you reference.

POINT tag format (embed inline in your text):
[POINT:x,y:label:screenN]

- x,y MUST be in IMAGE pixel coordinates of the screenshot
- x ranges from 0 to imageWidth-1
- y ranges from 0 to imageHeight-1
- label = 2-5 word description
- screenN = screen index (screen0, screen1, ...)

## Examples

User: "How do I add this video to a playlist?"
(Screens: screen0 1568x882)
You: "Click 'Save' [POINT:920,820:Save button:screen0] below the video."

User: "Where's the back button?"
(Screens: screen0 1280x720)
You: "Here [POINT:30,75:Back arrow:screen0]."

## Multi-monitor

When multiple screens, scan ALL screenshots. Use the screenN that matches where you found the element.

## Rules

1. Visual questions → include POINT tags with IMAGE coordinates
2. One POINT tag per UI element
3. Be concise
4. Skip POINT for non-visual questions

## PRE-SEND CHECKLIST

- [ ] Does response mention a clickable element?
- [ ] Each element has [POINT:x,y:label:screenN]?
- [ ] screenN matches actual screen?`;

export class OllamaService {
  private settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.settings = settings;
  }

  async query(params: OllamaQueryParams): Promise<OllamaResponse> {
    const model = this.settings.get("ollamaModel");
    const baseUrl = "http://localhost:11434/v1";

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
        `Screens (use these IMAGE dimensions for POINT coordinates):`,
        ...params.screenshots.map((s, i) =>
          `  screen${i}: ${s.imageDimensions.width}x${s.imageDimensions.height} px`
        ),
      ].join("\n"),
    });

    const messages = params.conversationHistory.map((entry) => ({
      role: entry.role,
      content: entry.role === "user" && entry.content === params.transcript
        ? userContent
        : entry.content,
    }));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const text = data.choices[0]?.message?.content || "";

    return { text };
  }

  async refinePoint(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string
  ): Promise<{ x: number; y: number } | null> {
    const model = this.settings.get("ollamaModel");
    const baseUrl = "http://localhost:11434/v1";

    const system =
      `You are a precise UI pointing tool. Return ONLY "x,y" — integer pixel coordinates of the exact visual center of "${label}" in the crop. ` +
      `Crop origin 0,0 = top-left. If not visible, return "none".`;

    const userContent = [
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${cropBase64}` },
      },
      {
        type: "text",
        text: `Crop: ${cropWidth}x${cropHeight}. Target: "${label}". Return "x,y".`,
      },
    ];

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices[0]?.message?.content?.trim() || "";

      const match = text.match(/(\d+)\s*,\s*(\d+)/);
      if (!match) return null;
      return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
    } catch {
      return null;
    }
  }
}