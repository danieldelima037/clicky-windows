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

const SYSTEM_PROMPT = `You are a strict Visual QA model. Your job is to locate the object requested by the user.
The image has a red 10x10 grid to assist your spatial reasoning.

Follow these mental steps:
1. Identify the object.
2. Look at the red grid. The columns go from 0 (left) to 10 (right). The rows go from 0 (top) to 10 (bottom).
3. Estimate the column and row of the object (e.g., column 1.5, row 2.0).
4. Multiply both by 10 to get the exact PERCENTAGE (X and Y) between 0 and 100.
   - Example 1: Top-Left corner is column 0.5, row 0.5. -> X=5, Y=5
   - Example 2: Exact middle is column 5, row 5. -> X=50, Y=50
   - Example 3: Bottom-Right corner is column 9.5, row 9.5. -> X=95, Y=95

You MUST return the final percentages in this format:
[CLICK_PCT:x,y:screenN]

Do not refuse. Output ONLY the bracket tag.`;

import { Jimp } from "jimp";

async function applyGridOverlay(base64Data: string): Promise<string> {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    const image = await Jimp.read(buffer);
    
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    
    const gridCells = 10;
    const cellW = width / gridCells;
    const cellH = height / gridCells;
    
    const color = 0xff0000ff; // Red
    
    for (let i = 1; i < gridCells; i++) {
      const x = Math.floor(i * cellW);
      for (let y = 0; y < height; y++) {
        image.setPixelColor(color, x, y);
        if (x > 0) image.setPixelColor(color, x - 1, y);
        if (x < width - 1) image.setPixelColor(color, x + 1, y);
      }
    }
    
    for (let i = 1; i < gridCells; i++) {
      const y = Math.floor(i * cellH);
      for (let x = 0; x < width; x++) {
        image.setPixelColor(color, x, y);
        if (y > 0) image.setPixelColor(color, x, y - 1);
        if (y < height - 1) image.setPixelColor(color, x, y + 1);
      }
    }
    
    const base64WithMime = await image.getBase64("image/jpeg");
    return base64WithMime.split(",")[1] || base64Data;
  } catch (e) {
    console.error("Grid error:", e);
    return base64Data;
  }
}

/**
 * OpenRouter chat service — OpenAI-compatible API that routes to 300+ models.
 * Supports Claude, GPT, Llama, Mistral, Gemini, and more through one endpoint.
 */
export class OpenRouterChatService {
  private settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.settings = settings;
  }

  async query(params: ChatQueryParams): Promise<ChatResponse> {
    const apiKey = this.settings.get("openrouterApiKey");
    const model = this.settings.get("openrouterModel");

    const userContent: Array<Record<string, unknown>> = [];

    const screenshotsToProcess = params.screenshots.slice(0, 1);
    for (const screenshot of screenshotsToProcess) {
      const griddedBase64 = await applyGridOverlay(screenshot.data);
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${griddedBase64}`,
        },
      });
    }

    userContent.push({
      type: "text",
      text: [
        "SYSTEM INSTRUCTIONS:\n" + SYSTEM_PROMPT,
        `\nUser says: "${params.transcript}"`,
        `Cursor position: (${params.cursorPosition.x}, ${params.cursorPosition.y})`,
      ].join("\n"),
    });

    const messages: Array<Record<string, unknown>> = [];
    const lastUserIndex = params.conversationHistory.map(e => e.role).lastIndexOf("user");

    for (let i = 0; i < params.conversationHistory.length; i++) {
      const entry = params.conversationHistory[i];
      if (i === lastUserIndex) {
        messages.push({ role: "user", content: userContent });
      } else {
        messages.push({ role: entry.role, content: entry.content });
      }
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/tekram/clicky-windows",
          "X-Title": "Clicky Windows",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices[0]?.message?.content || "";
    return { text };
  }
}
