import { describe, it, expect } from "vitest";
import { buildScreenContext, FULL_SYSTEM_PROMPT, REFINEMENT_SYSTEM_PROMPT } from "../src/services/base-provider";

describe("buildScreenContext", () => {
  it("includes transcript and cursor position", () => {
    const result = buildScreenContext(
      "Where is the save button?",
      { x: 100, y: 200 },
      [{ imageDimensions: { width: 1568, height: 882 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
    );
    expect(result).toContain("Where is the save button?");
    expect(result).toContain("(100, 200)");
  });

  it("includes image dimensions for each screen", () => {
    const result = buildScreenContext(
      "test",
      { x: 0, y: 0 },
      [
        { imageDimensions: { width: 1568, height: 882 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { imageDimensions: { width: 1280, height: 720 }, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
      ]
    );
    expect(result).toContain("screen0: image is 1568x882");
    expect(result).toContain("screen1: image is 1280x720");
  });

  it("includes display bounds", () => {
    const result = buildScreenContext(
      "test",
      { x: 0, y: 0 },
      [{ imageDimensions: { width: 1568, height: 882 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
    );
    expect(result).toContain("1920x1080");
  });
});

describe("FULL_SYSTEM_PROMPT", () => {
  it("contains POINT tag format", () => {
    expect(FULL_SYSTEM_PROMPT).toContain("[POINT:x,y:label:screenN]");
  });

  it("contains multi-monitor instructions", () => {
    expect(FULL_SYSTEM_PROMPT).toContain("screen0");
    expect(FULL_SYSTEM_PROMPT).toContain("Multi-monitor");
  });

  it("contains disambiguation guidance", () => {
    expect(FULL_SYSTEM_PROMPT).toContain("visually similar");
  });

  it("contains pre-send checklist", () => {
    expect(FULL_SYSTEM_PROMPT).toContain("PRE-SEND CHECKLIST");
  });
});

describe("REFINEMENT_SYSTEM_PROMPT", () => {
  it("instructs to return x,y only", () => {
    expect(REFINEMENT_SYSTEM_PROMPT).toContain('"x,y"');
  });

  it("instructs to return none if not visible", () => {
    expect(REFINEMENT_SYSTEM_PROMPT).toContain('"none"');
  });

  it("warns about visually similar elements", () => {
    expect(REFINEMENT_SYSTEM_PROMPT).toContain("visually similar neighboring");
  });
});
