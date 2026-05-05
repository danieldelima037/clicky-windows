import { describe, it, expect } from "vitest";
import * as crypto from "crypto";

describe("Settings encryption (direct crypto)", () => {
  const SETTINGS_KEY = crypto.scryptSync("clicky-windows-settings", "salt", 32);

  function encrypt(plaintext: string): string {
    if (!plaintext) return "";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", SETTINGS_KEY, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    return "enc:" + iv.toString("hex") + ":" + encrypted;
  }

  function decrypt(stored: string): string {
    if (!stored || !stored.startsWith("enc:")) return stored;
    const parts = stored.split(":");
    if (parts.length !== 3) return stored;
    const iv = Buffer.from(parts[1], "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", SETTINGS_KEY, iv);
    let decrypted = decipher.update(parts[2], "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  it("encrypts API key and decrypts back correctly", () => {
    const original = "sk-ant-api03-1234567890abcdef";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.startsWith("enc:")).toBe(true);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const original = "sk-test-key";
    const enc1 = encrypt(original);
    const enc2 = encrypt(original);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(original);
    expect(decrypt(enc2)).toBe(original);
  });

  it("returns empty string for empty input", () => {
    expect(encrypt("")).toBe("");
    expect(decrypt("")).toBe("");
  });

  it("passes through non-encrypted values", () => {
    expect(decrypt("plain-text")).toBe("plain-text");
    expect(decrypt("not-enc:format")).toBe("not-enc:format");
  });

  it("handles typical API key formats", () => {
    const keys = [
      "sk-ant-api03-xxxxxxxxxxxx",
      "sk-proj-xxxxxxxxxxxx",
      "sk-or-v1-xxxxxxxxxxxx",
      "nvapi-xxxxxxxxxxxx",
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ];
    for (const key of keys) {
      const encrypted = encrypt(key);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(key);
    }
  });
});

describe("Settings debounced save", () => {
  it("debounce timer prevents duplicate saves", async () => {
    let saveCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;

    function scheduleSave() {
      dirty = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (dirty) {
          dirty = false;
          saveCount++;
        }
      }, 10);
    }

    scheduleSave();
    scheduleSave();
    scheduleSave();
    expect(saveCount).toBe(0);

    await new Promise((r) => setTimeout(r, 50));
    expect(saveCount).toBe(1);
  });
});
