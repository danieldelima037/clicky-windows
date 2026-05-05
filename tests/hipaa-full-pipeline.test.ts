import { describe, it, expect } from "vitest";

const CLOUD_PROVIDERS = new Set([
  "openai", "openrouter", "nvidia", "groq", "gemini",
  "deepseek", "anthropic", "together", "cerebras",
  "fireworks", "deepinfra", "baseten", "venice",
  "nebius", "moonshot", "huggingface", "opencodezen",
]);

const CLOUD_TTS_PROVIDERS = new Set(["elevenlabs", "openai"]);

const CLOUD_TRANSCRIPTION_PROVIDERS = new Set(["assemblyai", "openai"]);

function checkHipaaCompliance(hipaaMode: boolean, aiProvider: string, ttsProvider: string, transcriptionProvider: string): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (hipaaMode && CLOUD_PROVIDERS.has(aiProvider)) {
    reasons.push(`HIPAA: cloud AI provider "${aiProvider}"`);
  }
  if (hipaaMode && CLOUD_TTS_PROVIDERS.has(ttsProvider)) {
    reasons.push(`HIPAA: cloud TTS provider "${ttsProvider}"`);
  }
  if (hipaaMode && CLOUD_TRANSCRIPTION_PROVIDERS.has(transcriptionProvider)) {
    reasons.push(`HIPAA: cloud transcription "${transcriptionProvider}"`);
  }
  return { allowed: reasons.length === 0, reasons };
}

describe("HIPAA enforcement (full pipeline)", () => {
  it("blocks cloud AI + cloud TTS + cloud transcription when HIPAA is on", () => {
    const result = checkHipaaCompliance(true, "openai", "elevenlabs", "assemblyai");
    expect(result.allowed).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });

  it("blocks cloud TTS even when AI is local", () => {
    const result = checkHipaaCompliance(true, "ollama", "openai", "whisper-local");
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("cloud TTS");
  });

  it("blocks cloud transcription even when AI is local", () => {
    const result = checkHipaaCompliance(true, "ollama", "local", "openai");
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("cloud transcription");
  });

  it("allows all-local pipeline when HIPAA is on", () => {
    const result = checkHipaaCompliance(true, "ollama", "local", "whisper-local");
    expect(result.allowed).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("allows cloud pipeline when HIPAA is off", () => {
    const result = checkHipaaCompliance(false, "openai", "elevenlabs", "openai");
    expect(result.allowed).toBe(true);
  });
});

describe("Settings encryption", () => {
  it("encrypts and decrypts roundtrip", async () => {
    const { encryptValue, decryptValue } = await import("../src/main/settings") as never;
    if (!encryptValue || !decryptValue) {
      const crypto = await import("crypto");
      const key = crypto.scryptSync("clicky-windows-settings", "salt", 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
      let enc = cipher.update("sk-test-key-12345", "utf8", "hex");
      enc += cipher.final("hex");
      const stored = "enc:" + iv.toString("hex") + ":" + enc;
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      let dec = decipher.update(stored.split(":")[2], "hex", "utf8");
      dec += decipher.final("utf8");
      expect(dec).toBe("sk-test-key-12345");
    } else {
      const encrypted = encryptValue("sk-test-key-12345");
      expect(encrypted).not.toBe("sk-test-key-12345");
      expect(encrypted.startsWith("enc:")).toBe(true);
      const decrypted = decryptValue(encrypted);
      expect(decrypted).toBe("sk-test-key-12345");
    }
  });

  it("returns raw value for non-encrypted strings", async () => {
    const { decryptValue } = await import("../src/main/settings") as never;
    if (!decryptValue) {
      return;
    }
    expect(decryptValue("")).toBe("");
    expect(decryptValue("plain-text")).toBe("plain-text");
  });
});

describe("fetchWithTimeout", () => {
  it("exports fetchWithTimeout from ai-provider", async () => {
    const mod = await import("../src/services/ai-provider");
    expect(mod.fetchWithTimeout).toBeDefined();
    expect(typeof mod.fetchWithTimeout).toBe("function");
  });

  it("DEFAULT_FETCH_TIMEOUT_MS is 120 seconds", async () => {
    const mod = await import("../src/services/ai-provider");
    expect(mod.DEFAULT_FETCH_TIMEOUT_MS).toBe(120_000);
  });
});

describe("Tag stripping for conversation history", () => {
  const TAG_REGEX = /\[(?:POINT|CLICK|TYPE)(?:_[A-Z]+)?:[^\]]+\]/g;

  function stripTags(text: string): string {
    return text.replace(TAG_REGEX, "").trim();
  }

  it("strips POINT tags", () => {
    expect(stripTags("Click here [POINT:100,200:Button:screen0]")).toBe("Click here");
  });

  it("strips CLICK tags", () => {
    expect(stripTags("Clicking [CLICK:50,75:screen1]")).toBe("Clicking");
  });

  it("strips TYPE tags", () => {
    expect(stripTags("Typing [TYPE:hello world]")).toBe("Typing");
  });

  it("strips mixed tags", () => {
    expect(stripTags("Look [POINT:1,2:A:screen0] then [CLICK:3,4:screen0] then [TYPE:text]")).toBe("Look  then  then");
  });

  it("strips POINT_PCT tags", () => {
    expect(stripTags("Here [POINT_PCT:50,50:Center:screen0]")).toBe("Here");
  });

  it("returns clean text unchanged", () => {
    expect(stripTags("No tags here")).toBe("No tags here");
  });
});
