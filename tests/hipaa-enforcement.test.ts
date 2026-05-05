import { describe, it, expect } from "vitest";

const CLOUD_PROVIDERS = new Set([
  "openai", "openrouter", "nvidia", "groq", "gemini",
  "deepseek", "anthropic", "together", "cerebras",
  "fireworks", "deepinfra", "baseten", "venice",
  "nebius", "moonshot", "huggingface", "opencodezen",
]);

function checkHipaaCompliance(hipaaMode: boolean, provider: string): { allowed: boolean; reason?: string } {
  if (hipaaMode && CLOUD_PROVIDERS.has(provider)) {
    return {
      allowed: false,
      reason: `HIPAA mode is enabled — cannot use cloud provider "${provider}"`,
    };
  }
  return { allowed: true };
}

describe("HIPAA enforcement", () => {
  it("blocks cloud providers when HIPAA is on", () => {
    for (const provider of CLOUD_PROVIDERS) {
      const result = checkHipaaCompliance(true, provider);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("HIPAA");
    }
  });

  it("allows local providers when HIPAA is on", () => {
    const localProviders = ["ollama", "lmstudio", "custom"];
    for (const provider of localProviders) {
      expect(checkHipaaCompliance(true, provider).allowed).toBe(true);
    }
  });

  it("allows all providers when HIPAA is off", () => {
    for (const provider of CLOUD_PROVIDERS) {
      expect(checkHipaaCompliance(false, provider).allowed).toBe(true);
    }
  });

  it("allows local providers when HIPAA is off", () => {
    expect(checkHipaaCompliance(false, "ollama").allowed).toBe(true);
  });
});
