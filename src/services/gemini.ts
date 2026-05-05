import { SettingsStore } from "../main/settings";
import {
  BaseAIProvider,
  FULL_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
  buildScreenContext,
} from "./base-provider";
import { AIProviderQueryParams, AIProviderResponse, fetchWithTimeout } from "./ai-provider";

interface GoogleRpcRetryInfo {
  "@type": string;
  retryDelay?: string;
}

export class GeminiService extends BaseAIProvider {
  constructor(settings: SettingsStore) {
    super(settings);
  }

  private getBaseUrl(model: string): string {
    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");
    return useProxy && proxyUrl
      ? proxyUrl
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  async query(params: AIProviderQueryParams, retryCount = 0): Promise<AIProviderResponse> {
    const apiKey = this.settings.get("geminiApiKey");
    const model = this.settings.get("geminiModel");
    const baseUrl = this.getBaseUrl(model);

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
      text: buildScreenContext(
        params.transcript,
        params.cursorPosition,
        params.screenshots
      ),
    });

    const historyContents = params.conversationHistory.map((entry) => ({
      role: entry.role,
      parts:
        entry.role === "user" && entry.content === params.transcript
          ? contents
          : [{ text: entry.content }],
    }));

    try {
      const response = await fetchWithTimeout(`${baseUrl}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            role: "system",
            parts: [{ text: FULL_SYSTEM_PROMPT }],
          },
          contents: historyContents,
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.7,
          },
        }),
        signal: params.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 429 && retryCount < 3) {
          let retryDelay = 2000;

          try {
            const errorJson = JSON.parse(errorText);
            const retryInfo = errorJson?.error?.details?.find(
              (d: GoogleRpcRetryInfo) =>
                d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
            );
            if (retryInfo?.retryDelay) {
              retryDelay = parseFloat(retryInfo.retryDelay) * 1000 || 16000;
            }
    } catch {
      retryDelay = Math.pow(2, retryCount) * 5000;
      console.warn("[Gemini] Rate limit parse failed, using exponential backoff");
    }

          console.warn(
            `[Gemini] Rate limited. Retrying in ${retryDelay / 1000}s... (Attempt ${retryCount + 1}/3)`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          return this.query(params, retryCount + 1);
        }

        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { text };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("429") &&
        retryCount < 3
      ) {
        const delay = Math.pow(2, retryCount) * 5000;
        console.warn(
          `[Gemini] Network error/429. Retrying in ${delay / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.query(params, retryCount + 1);
      }
      throw error;
    }
  }

  async refinePoint(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string,
    retryCount = 0
  ): Promise<{ x: number; y: number } | null> {
    const apiKey = this.settings.get("geminiApiKey");
    const model = this.settings.get("geminiModel");
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    try {
      const response = await fetchWithTimeout(`${baseUrl}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/jpeg", data: cropBase64 } },
                {
                  text: `Crop image size: ${cropWidth}x${cropHeight} pixels (origin 0,0 = top-left).\nTarget element: "${label}"\nReturn the pixel center as "x,y" only.`,
                },
              ],
            },
          ],
          systemInstruction: {
            role: "system",
            parts: [{ text: REFINEMENT_SYSTEM_PROMPT }],
          },
          generationConfig: { maxOutputTokens: 32 },
        }),
      });

      if (!response.ok) {
        if (response.status === 429 && retryCount < 2) {
          console.warn(
            `[Gemini] refinePoint rate limited. Retrying in 5s...`
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return this.refinePoint(
            cropBase64,
            cropWidth,
            cropHeight,
            label,
            retryCount + 1
          );
        }
        return null;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      return this.parseCoordResponse(text);
    } catch (err) {
      console.warn("[Gemini] refinePoint failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
}
