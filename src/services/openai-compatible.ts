import {
  BaseAIProvider,
  FULL_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
  buildScreenContext,
} from "./base-provider";
import { AIProviderQueryParams, AIProviderResponse, fetchWithTimeout } from "./ai-provider";
import type { SettingsSchema } from "../main/settings";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKeySetting: keyof SettingsSchema;
  modelSetting: keyof SettingsSchema;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  providerLabel: string;
  useRefinementBaseUrl?: string;
}

export class OpenAICompatibleProvider extends BaseAIProvider {
  private config: OpenAICompatibleConfig;

  constructor(settings: import("../main/settings").SettingsStore, config: OpenAICompatibleConfig) {
    super(settings);
    this.config = config;
  }

  async query(params: AIProviderQueryParams): Promise<AIProviderResponse> {
    const apiKey = this.settings.get(this.config.apiKeySetting) as string;
    const model = this.settings.get(this.config.modelSetting) as string;
    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");

    const baseUrl = useProxy && proxyUrl ? proxyUrl : this.config.baseUrl;

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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...this.config.extraHeaders,
    };

    const body: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      messages: [{ role: "system", content: FULL_SYSTEM_PROMPT }, ...messages],
      ...this.config.extraBody,
    };

    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `${this.config.providerLabel} API error (${response.status}): ${error}`
      );
    }

    const data = (await response.json()) as {
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
    const apiKey = this.settings.get(this.config.apiKeySetting) as string;
    const model = this.settings.get(this.config.modelSetting) as string;
    const baseUrl = this.config.useRefinementBaseUrl || this.config.baseUrl;

    const userContent = [
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${cropBase64}` },
      },
      {
        type: "text",
        text: `Crop image size: ${cropWidth}x${cropHeight} pixels (origin 0,0 = top-left).\nTarget element: "${label}"\nReturn the pixel center as "x,y" only.`,
      },
    ];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...this.config.extraHeaders,
    };

    try {
      const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 32,
          messages: [
            { role: "system", content: REFINEMENT_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices[0]?.message?.content?.trim() || "";
      return this.parseCoordResponse(text);
    } catch (err) {
      console.warn(`[Clicky] ${this.config.providerLabel} refinePoint failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
}
