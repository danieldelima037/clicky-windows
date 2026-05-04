import { SettingsStore } from "../main/settings";
import { ScreenshotResult } from "../main/screenshot";

interface GeminiQueryParams {
  transcript: string;
  screenshots: ScreenshotResult[];
  cursorPosition: { x: number; y: number };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

interface GeminiResponse {
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

export class GeminiService {
  private settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.settings = settings;
  }

  async query(params: GeminiQueryParams): Promise<GeminiResponse> {
    const apiKey = this.settings.get("geminiApiKey");
    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");
    const model = this.settings.get("geminiModel");

    const baseUrl = useProxy && proxyUrl
      ? proxyUrl
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const contents: Array<Record<string, unknown>> = [];

    for (const screenshot of params.screenshots) {
      contents.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: screenshot.data,
        },
      });
    }

    contents.push({
      text: [
        `User says: "${params.transcript}"`,
        `Cursor position: (${params.cursorPosition.x}, ${params.cursorPosition.y})`,
        `Screens (use these IMAGE dimensions for POINT coordinates):`,
        ...params.screenshots.map((s, i) =>
          `  screen${i}: ${s.imageDimensions.width}x${s.imageDimensions.height} px`
        ),
      ].join("\n"),
    });

    const historyContents = params.conversationHistory.map((entry) => ({
      role: entry.role,
      parts: entry.role === "user" && entry.content === params.transcript
        ? contents
        : [{ text: entry.content }],
    }));

    const response = await fetch(`${baseUrl}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          role: "system",
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: historyContents,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return { text };
  }

  async refinePoint(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string
  ): Promise<{ x: number; y: number } | null> {
    const apiKey = this.settings.get("geminiApiKey");
    const model = this.settings.get("geminiModel");
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const system =
      `You are a precise UI pointing tool. Return ONLY "x,y" — integer pixel coordinates of the exact visual center of "${label}" in the crop. ` +
      `Crop origin 0,0 = top-left. If not visible, return "none".`;

    try {
      const response = await fetch(`${baseUrl}?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/jpeg", data: cropBase64 } },
                {
                  text: `Crop: ${cropWidth}x${cropHeight}. Target: "${label}". Return "x,y".`,
                },
              ],
            },
          ],
          systemInstruction: { role: "system", parts: [{ text: system }] },
          generationConfig: { maxOutputTokens: 32 },
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

      const match = text.match(/(\d+)\s*,\s*(\d+)/);
      if (!match) return null;
      return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
    } catch {
      return null;
    }
  }
}