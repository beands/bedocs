import { describe, expect, it } from "bun:test";

import {
  escapeRawHtml,
  unwrapParagraph,
} from "../src/components/content/inline-markdown.ts";

describe("escapeRawHtml", () => {
  it("neutralizes raw tags but leaves entities authorable", () => {
    expect(escapeRawHtml("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
    // `&` stays: CommonMark resolves entities itself, so `&copy;` keeps
    // rendering as © instead of the literal text `&copy;`.
    expect(escapeRawHtml("a &copy; b")).toBe("a &copy; b");
  });
});

describe("unwrapParagraph", () => {
  it("unwraps a single rendered paragraph", () => {
    expect(unwrapParagraph("<p>hi <em>there</em></p>")).toBe(
      "hi <em>there</em>"
    );
    expect(unwrapParagraph("  <p>trimmed</p>\n")).toBe("trimmed");
  });

  it("leaves multi-paragraph and non-paragraph HTML balanced", () => {
    const multi = "<p>a</p>\n<p>b</p>";
    expect(unwrapParagraph(multi)).toBe(multi);
    expect(unwrapParagraph("<ul><li>x</li></ul>")).toBe("<ul><li>x</li></ul>");
  });
});
