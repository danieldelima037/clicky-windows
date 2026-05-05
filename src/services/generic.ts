import { SettingsStore, SettingsSchema } from "../main/settings";
import {
  BaseAIProvider,
  FULL_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
  buildScreenContext,
} from "./base-provider";
import { AIProviderQueryParams, AIProviderResponse, fetchWithTimeout } from "./ai-provider";

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

export class GenericAIProvider extends BaseAIProvider {
  private providerType: string;

  constructor(settings: SettingsStore, providerType: string) {
    super(settings);
    this.providerType = providerType;
  }

  private getProviderSettings(): { model: string; apiKey: string; customBaseUrl: string } {
    const allSettings = this.settings.getAll();
    const modelKey = `${this.providerType}Model` as keyof SettingsSchema;
    const apiKeyKey = `${this.providerType}ApiKey` as keyof SettingsSchema;
    const model = (typeof allSettings[modelKey] === "string" ? allSettings[modelKey] : allSettings.customModel) as string;
    const apiKey = (typeof allSettings[apiKeyKey] === "string" ? allSettings[apiKeyKey] : allSettings.customApiKey) as string;
    const customBaseUrl = allSettings.customBaseUrl as string;
    return { model, apiKey, customBaseUrl };
  }

  private resolveBaseUrl(model: string, customBaseUrl: string): string {
    const config = PROVIDER_CONFIGS[this.providerType] || PROVIDER_CONFIGS.custom;
    let baseUrl = config.baseUrl;

    if (this.providerType === "azure") {
      const resource = this.settings.get("azureResourceName" as keyof SettingsSchema) as string;
      if (!resource) {
        throw new Error("Azure resource name not configured. Set it in Settings.");
      }
      baseUrl = baseUrl.replace("{resource}", resource).replace("{model}", model);
    } else if (this.providerType === "custom") {
      baseUrl = customBaseUrl || "http://localhost:8000/v1";
    }

    return baseUrl;
  }

  async query(params: AIProviderQueryParams): Promise<AIProviderResponse> {
    const { model, apiKey, customBaseUrl } = this.getProviderSettings();
    const config = PROVIDER_CONFIGS[this.providerType] || PROVIDER_CONFIGS.custom;
    const baseUrl = this.resolveBaseUrl(model, customBaseUrl);

    const userContent: Array<Record<string, unknown>> = [];

    for (const screenshot of params.screenshots) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${screenshot.data}` },
      });
    }

    userContent.push({
      type: "text",
      text: buildScreenContext(params.transcript, params.cursorPosition, params.screenshots),
    });

    const messages = params.conversationHistory.map((entry) => ({
      role: entry.role,
      content: entry.role === "user" && entry.content === params.transcript ? userContent : entry.content,
    }));

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (config.authHeader === "api-key") {
      headers["api-key"] = apiKey;
    } else if (config.authHeader === "Authorization" || config.authHeader === "Bearer") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else {
      headers[config.authHeader] = apiKey;
    }

      const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: "system", content: FULL_SYSTEM_PROMPT }, ...messages],
        }),
        signal: params.signal,
      });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerType} API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return { text: data.choices[0]?.message?.content || "" };
  }

  async refinePoint(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string
  ): Promise<{ x: number; y: number } | null> {
    const { model, apiKey, customBaseUrl } = this.getProviderSettings();
    const config = PROVIDER_CONFIGS[this.providerType] || PROVIDER_CONFIGS.custom;
    const baseUrl = this.resolveBaseUrl(model, customBaseUrl);

    const userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${cropBase64}` } },
      { type: "text", text: `Crop image size: ${cropWidth}x${cropHeight} pixels (origin 0,0 = top-left).\nTarget element: "${label}"\nReturn the pixel center as "x,y" only.` },
    ];

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (config.authHeader === "api-key") {
      headers["api-key"] = apiKey;
    } else if (config.authHeader === "Authorization" || config.authHeader === "Bearer") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else {
      headers[config.authHeader] = apiKey;
    }

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

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      const text = data.choices[0]?.message?.content?.trim() || "";
      return this.parseCoordResponse(text);
    } catch (err) {
      console.warn(`[Clicky] ${this.providerType} refinePoint failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
}
