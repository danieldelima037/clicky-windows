import { SettingsStore } from "../main/settings";
import { ScreenshotResult } from "../main/screenshot";

interface GenericQueryParams {
  transcript: string;
  screenshots: ScreenshotResult[];
  cursorPosition: { x: number; y: number };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

interface GenericResponse {
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

const PROVIDER_CONFIGS: Record<string, { baseUrl: string; authHeader: string }> = {
  azure: {
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{model}",
    authHeader: "api-key",
  },
  huggingface: {
    baseUrl: "https://api-inference.huggingface.co/models/{model}",
    authHeader: "Authorization",
  },
  together: {
    baseUrl: "https://api.together.ai/v1",
    authHeader: "Bearer",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    authHeader: "Bearer",
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/v1",
    authHeader: "Bearer",
  },
  deepinfra: {
    baseUrl: "https://api.deepinfra.com/v1",
    authHeader: "Bearer",
  },
  baseten: {
    baseUrl: "https://api.baseten.co/v1",
    authHeader: "Bearer",
  },
  venice: {
    baseUrl: "https://api.venice.ai/v1",
    authHeader: "Bearer",
  },
  nebius: {
    baseUrl: "https://api.nebius.ai/v1",
    authHeader: "Bearer",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.ai/v1",
    authHeader: "Bearer",
  },
  custom: {
    baseUrl: "{customUrl}",
    authHeader: "Bearer",
  },
};

export class GenericAIProvider {
  private settings: SettingsStore;
  private providerType: string;

  constructor(settings: SettingsStore, providerType: string) {
    this.settings = settings;
    this.providerType = providerType;
  }

  async query(params: GenericQueryParams): Promise<GenericResponse> {
    const allSettings = this.settings.getAll();
    const modelKey = `${this.providerType}Model` as keyof typeof allSettings;
    const apiKeyKey = `${this.providerType}ApiKey` as keyof typeof allSettings;
    const model = allSettings[modelKey] as string || allSettings.customModel as string;
    const apiKey = allSettings[apiKeyKey] as string || allSettings.customApiKey as string;
    const customBaseUrl = allSettings.customBaseUrl as string;

    const config = PROVIDER_CONFIGS[this.providerType] || PROVIDER_CONFIGS.custom;
    let baseUrl = config.baseUrl;

    if (this.providerType === "azure") {
      const resource = "my-resource";
      baseUrl = baseUrl.replace("{resource}", resource).replace("{model}", model);
    } else if (this.providerType === "custom") {
      baseUrl = customBaseUrl || "http://localhost:8000/v1";
    }

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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    headers[config.authHeader] = apiKey;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
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
      throw new Error(`${this.providerType} API error (${response.status}): ${error}`);
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
    const allSettings = this.settings.getAll();
    const modelKey = `${this.providerType}Model` as keyof typeof allSettings;
    const apiKeyKey = `${this.providerType}ApiKey` as keyof typeof allSettings;
    const model = allSettings[modelKey] as string || allSettings.customModel as string;
    const apiKey = allSettings[apiKeyKey] as string || allSettings.customApiKey as string;
    const customBaseUrl = allSettings.customBaseUrl as string;

    const config = PROVIDER_CONFIGS[this.providerType] || PROVIDER_CONFIGS.custom;
    let baseUrl = config.baseUrl;

    if (this.providerType === "custom") {
      baseUrl = customBaseUrl || "http://localhost:8000/v1";
    }

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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    headers[config.authHeader] = apiKey;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
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