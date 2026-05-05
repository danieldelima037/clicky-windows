import { describe, it, expect } from "vitest";
import { pcmToWav, buildWavHeader } from "../src/services/transcription/wav";

describe("WAV header generation", () => {
  it("produces valid RIFF header", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("sets correct file size", () => {
    const dataSize = 1000;
    const header = buildWavHeader(dataSize, 16000);
    expect(header.readUInt32LE(4)).toBe(36 + dataSize);
  });

  it("sets PCM format", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.readUInt16LE(20)).toBe(1);
  });

  it("sets mono channel", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.readUInt16LE(22)).toBe(1);
  });

  it("sets 16-bit sample depth", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.readUInt16LE(34)).toBe(16);
  });

  it("sets correct sample rate", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.readUInt32LE(24)).toBe(16000);
  });

  it("sets correct byte rate", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.readUInt32LE(28)).toBe(32000);
  });

  it("sets data chunk id and size", () => {
    const header = buildWavHeader(1000, 16000);
    expect(header.toString("ascii", 36, 40)).toBe("data");
    expect(header.readUInt32LE(40)).toBe(1000);
  });

  it("header is always 44 bytes", () => {
    expect(buildWavHeader(0, 16000).length).toBe(44);
    expect(buildWavHeader(99999, 44100).length).toBe(44);
  });
});

describe("pcmToWav", () => {
  it("prepends header to PCM data", () => {
    const pcm = Buffer.alloc(100, 0);
    const wav = pcmToWav(pcm, 16000);
    expect(wav.length).toBe(44 + 100);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  });
});
