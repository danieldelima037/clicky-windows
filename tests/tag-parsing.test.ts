import { describe, it, expect } from "vitest";

const POINT_REGEX = /\[POINT(_PCT)?:([\d.]+),([\d.]+):([^:]+):screen(\d+)\]/gi;
const CLICK_REGEX = /\[CLICK(_PCT)?:([\d.]+),([\d.]+):screen(\d+)\]/gi;
const TYPE_REGEX = /\[TYPE:([^\]]+)\]/g;

function parsePointTags(text: string) {
  const tags: Array<{ x: number; y: number; label: string; screen: number; isPct?: boolean }> = [];
  let match: RegExpExecArray | null;
  while ((match = POINT_REGEX.exec(text)) !== null) {
    tags.push({
      isPct: !!match[1],
      x: parseFloat(match[2]),
      y: parseFloat(match[3]),
      label: match[4],
      screen: parseInt(match[5], 10),
    });
  }
  return tags;
}

function parseClickTags(text: string) {
  const tags: Array<{ x: number; y: number; screen: number; isPct?: boolean }> = [];
  let match: RegExpExecArray | null;
  while ((match = CLICK_REGEX.exec(text)) !== null) {
    tags.push({
      isPct: !!match[1],
      x: parseFloat(match[2]),
      y: parseFloat(match[3]),
      screen: parseInt(match[4], 10),
    });
  }
  return tags;
}

function parseTypeTags(text: string) {
  const tags: Array<{ text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = TYPE_REGEX.exec(text)) !== null) {
    tags.push({ text: match[1] });
  }
  return tags;
}

function stripAllTags(text: string): string {
  return text
    .replace(/\[POINT:[^\]]+\]/g, "")
    .replace(/\[CLICK:[^\]]+\]/g, "")
    .replace(/\[TYPE:[^\]]+\]/g, "")
    .trim();
}

describe("POINT tag parsing", () => {
  it("parses basic POINT tag", () => {
    const result = parsePointTags("Click here [POINT:920,820:Save button:screen0]");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 920, y: 820, label: "Save button", screen: 0, isPct: false });
  });

  it("parses POINT_PCT tag", () => {
    const result = parsePointTags("[POINT_PCT:50,75:Center:screen1]");
    expect(result).toHaveLength(1);
    expect(result[0].isPct).toBe(true);
    expect(result[0].x).toBe(50);
    expect(result[0].screen).toBe(1);
  });

  it("parses multiple POINT tags", () => {
    const text = "First [POINT:100,200:A:screen0] then [POINT:300,400:B:screen1]";
    const result = parsePointTags(text);
    expect(result).toHaveLength(2);
  });

  it("parses decimal coordinates", () => {
    const result = parsePointTags("[POINT:10.5,20.3:Label:screen0]");
    expect(result[0].x).toBeCloseTo(10.5);
    expect(result[0].y).toBeCloseTo(20.3);
  });

  it("returns empty for no tags", () => {
    expect(parsePointTags("no tags here")).toHaveLength(0);
  });
});

describe("CLICK tag parsing", () => {
  it("parses basic CLICK tag", () => {
    const result = parseClickTags("[CLICK:100,200:screen0]");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 100, y: 200, screen: 0, isPct: false });
  });

  it("parses CLICK_PCT tag", () => {
    const result = parseClickTags("[CLICK_PCT:50,50:screen1]");
    expect(result[0].isPct).toBe(true);
  });
});

describe("TYPE tag parsing", () => {
  it("parses TYPE tag", () => {
    const result = parseTypeTags("[TYPE:hello world]");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello world");
  });

  it("handles text with special characters", () => {
    const result = parseTypeTags("[TYPE:email@example.com]");
    expect(result[0].text).toBe("email@example.com");
  });
});

describe("Tag stripping", () => {
  it("strips all tag types", () => {
    const text = "Click [POINT:1,2:Label:screen0] then [CLICK:3,4:screen0] and [TYPE:text]";
    expect(stripAllTags(text)).toBe("Click  then  and");
  });

  it("handles text with no tags", () => {
    expect(stripAllTags("plain text")).toBe("plain text");
  });

  it("handles mixed content", () => {
    const text = "Save button [POINT:920,820:Save:screen0] is at the bottom";
    expect(stripAllTags(text)).toBe("Save button  is at the bottom");
  });
});
