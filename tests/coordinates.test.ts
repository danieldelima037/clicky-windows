import { describe, it, expect } from "vitest";

function scaleImageToDisplay(
  imgX: number,
  imgY: number,
  imageDimensions: { width: number; height: number },
  bounds: { width: number; height: number }
): { x: number; y: number } {
  const scaleX = bounds.width / imageDimensions.width;
  const scaleY = bounds.height / imageDimensions.height;
  return {
    x: Math.round(imgX * scaleX),
    y: Math.round(imgY * scaleY),
  };
}

function scalePctToDisplay(
  pctX: number,
  pctY: number,
  bounds: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: Math.round((pctX / 100) * bounds.width),
    y: Math.round((pctY / 100) * bounds.height),
  };
}

function mapRefinedToImageSpace(
  refinedX: number,
  refinedY: number,
  cropOrigin: { x: number; y: number },
  pxPerImageDim: number
): { x: number; y: number } {
  return {
    x: Math.round(cropOrigin.x + refinedX / pxPerImageDim),
    y: Math.round(cropOrigin.y + refinedY / pxPerImageDim),
  };
}

describe("Coordinate transformations", () => {
  const imageDimensions = { width: 1568, height: 882 };
  const bounds = { width: 1920, height: 1080 };

  describe("image-to-display scaling", () => {
    it("scales origin correctly", () => {
      const result = scaleImageToDisplay(0, 0, imageDimensions, bounds);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it("scales max image coord to display boundary", () => {
      const result = scaleImageToDisplay(1568, 882, imageDimensions, bounds);
      expect(result.x).toBe(1920);
      expect(result.y).toBe(1080);
    });

    it("scales center correctly", () => {
      const result = scaleImageToDisplay(784, 441, imageDimensions, bounds);
      expect(result.x).toBe(960);
      expect(result.y).toBe(540);
    });
  });

  describe("percentage-to-display scaling", () => {
    it("maps 0% to origin", () => {
      const result = scalePctToDisplay(0, 0, bounds);
      expect(result).toEqual({ x: 0, y: 0 });
    });

    it("maps 100% to full display", () => {
      const result = scalePctToDisplay(100, 100, bounds);
      expect(result).toEqual({ x: 1920, y: 1080 });
    });

    it("maps 50% to center", () => {
      const result = scalePctToDisplay(50, 50, bounds);
      expect(result).toEqual({ x: 960, y: 540 });
    });
  });

  describe("refinement-to-image-space mapping", () => {
    it("maps with identity ratio", () => {
      const result = mapRefinedToImageSpace(100, 200, { x: 0, y: 0 }, 1);
      expect(result).toEqual({ x: 100, y: 200 });
    });

    it("maps with offset origin", () => {
      const result = mapRefinedToImageSpace(50, 50, { x: 100, y: 200 }, 1);
      expect(result).toEqual({ x: 150, y: 250 });
    });

    it("maps with scale ratio", () => {
      const result = mapRefinedToImageSpace(200, 300, { x: 0, y: 0 }, 2);
      expect(result).toEqual({ x: 100, y: 150 });
    });

    it("maps with both offset and scale", () => {
      const result = mapRefinedToImageSpace(200, 300, { x: 50, y: 100 }, 2);
      expect(result).toEqual({ x: 150, y: 250 });
    });
  });
});
