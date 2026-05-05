import { describe, it, expect } from "vitest";

function buildEncodedCommand(psScript: string): string {
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  return `powershell -EncodedCommand ${encoded}`;
}

describe("PowerShell Base64 encoding", () => {
  it("produces valid base64 from UTF-16LE", () => {
    const cmd = buildEncodedCommand("Write-Host hello");
    expect(cmd).toMatch(/^powershell -EncodedCommand [A-Za-z0-9+/=]+$/);
  });

  it("handles single quotes safely", () => {
    const cmd = buildEncodedCommand("$synth.Speak('test')");
    expect(cmd).not.toContain("'");
    expect(cmd).not.toContain("$synth");
  });

  it("handles double quotes safely", () => {
    const cmd = buildEncodedCommand('$synth.Speak("test")');
    expect(cmd).not.toContain('"');
  });

  it("handles PowerShell variable expansion safely", () => {
    const malicious = '${env:COMSPEC}';
    const cmd = buildEncodedCommand(malicious);
    expect(cmd).not.toContain("${");
    expect(cmd).not.toContain("COMSPEC");
  });

  it("round-trips correctly", () => {
    const script = "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer";
    const cmd = buildEncodedCommand(script);
    const base64 = cmd.replace("powershell -EncodedCommand ", "");
    const decoded = Buffer.from(base64, "base64").toString("utf16le");
    expect(decoded).toBe(script);
  });
});
