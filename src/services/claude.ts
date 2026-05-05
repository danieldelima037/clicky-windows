import { SettingsStore } from "../main/settings";
import {
  BaseAIProvider,
  FULL_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
  buildScreenContext,
} from "./base-provider";
import { AIProviderQueryParams, AIProviderResponse, fetchWithTimeout } from "./ai-provider";

export class ClaudeService extends BaseAIProvider {
  constructor(settings: SettingsStore) {
    super(settings);
  }

  private getBaseUrl(): string {
    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");
    return useProxy && proxyUrl ? proxyUrl : "https://api.anthropic.com";
  }

  async query(params: AIProviderQueryParams): Promise<AIProviderResponse> {
    const apiKey = this.settings.get("anthropicApiKey");
    const model = this.settings.get("claudeModel");
    const baseUrl = this.getBaseUrl();

    const userContent: Array<Record<string, unknown>> = [];

    for (const screenshot of params.screenshots) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: screenshot.data,
        },
      });
    }

    userContent.push({
      type: "text",
      text: buildScreenContext(
        params.transcript,
        params.cursorPosition,
        params.screenshots
      ),
    });

    const messages = params.conversationHistory.map((entry) => ({
      role: entry.role,
      content:
        entry.role === "user" && entry.content === params.transcript
          ? userContent
          : entry.content,
    }));

    const response = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: FULL_SYSTEM_PROMPT,
        messages,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text };
  }

  async refinePoint(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string
  ): Promise<{ x: number; y: number } | null> {
    const apiKey = this.settings.get("anthropicApiKey");
    const model = this.settings.get("claudeModel");
    const baseUrl = this.getBaseUrl();

    const userContent = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: cropBase64 },
      },
      {
        type: "text",
        text: `Crop image size: ${cropWidth}x${cropHeight} pixels (origin 0,0 = top-left).\nTarget element: "${label}"\nReturn the pixel center as "x,y" only.`,
      },
    ];

    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          system: REFINEMENT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("")
        .trim();

      return this.parseCoordResponse(text);
    } catch (err) {
      console.warn("[Clicky] Claude refinePoint failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
}
