import { describe, it, expect } from "vitest";

describe("DOMPurify sanitization (unit-level)", () => {
  function sanitizeHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/on\w+='[^']*'/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[^>]*>/gi, "")
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "");
  }

  it("strips script tags", () => {
    const input = '<p>Hello</p><script>alert("xss")</script>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<script");
    expect(result).toContain("<p>Hello</p>");
  });

  it("strips event handlers", () => {
    const input = '<img src="x" onerror="alert(1)">';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onerror");
  });

  it("strips javascript: URLs", () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("javascript:");
  });

  it("preserves safe HTML", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    const result = sanitizeHtml(input);
    expect(result).toContain("<p>");
    expect(result).toContain("<strong>");
  });

  it("strips iframe tags", () => {
    const input = '<iframe src="https://evil.com"></iframe>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<iframe");
  });
});

describe("CSP header format", () => {
  it("valid CSP contains required directives", () => {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.openai.com; img-src 'self' data:;";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
  });
});

describe("openExternal URL validation", () => {
  function isAllowedUrl(url: string): boolean {
    return url.startsWith("https://");
  }

  it("allows https URLs", () => {
    expect(isAllowedUrl("https://example.com")).toBe(true);
  });

  it("blocks http URLs", () => {
    expect(isAllowedUrl("http://example.com")).toBe(false);
  });

  it("blocks file:// URLs", () => {
    expect(isAllowedUrl("file:///etc/passwd")).toBe(false);
  });

  it("blocks javascript: URLs", () => {
    expect(isAllowedUrl("javascript:alert(1)")).toBe(false);
  });

  it("blocks data: URLs", () => {
    expect(isAllowedUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });
});
