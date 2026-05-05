import { ScreenshotResult } from "../main/screenshot";

export interface AIProviderQueryParams {
  transcript: string;
  screenshots: ScreenshotResult[];
  cursorPosition: { x: number; y: number };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}

export interface AIProviderResponse {
  text: string;
}

export interface AIProvider {
  query(params: AIProviderQueryParams): Promise<AIProviderResponse>;
  refinePoint?(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string
  ): Promise<{ x: number; y: number } | null>;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return fetch(url, { ...init, signal }).finally(() => clearTimeout(timer));
}
