import { describe, expect, it } from "vitest";
import { renderMarkdownLite } from "./markdown";

describe("markdown for the task view", () => {
  it("renders the basics", () => {
    const html = renderMarkdownLite("## Steps\n\n- one **bold**\n- two `code`\n\n1. first\n2. second\n\n> quote\n\n```js\nconst a = 1 < 2;\n```");
    expect(html).toContain("<h4>Steps</h4>");
    expect(html).toContain("<ul>\n<li>one <strong>bold</strong></li>\n<li>two <code>code</code></li>\n</ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>quote</blockquote>");
    expect(html).toContain("<pre><code>const a = 1 &lt; 2;</code></pre>");
  });

  it("never lets task text inject markup or run script", () => {
    const html = renderMarkdownLite('<img src=x onerror="alert(1)"><script>alert(2)</script>\n\n[click](javascript:alert(3))\n[data](data:text/html;base64,AAAA)\n[ok](https://example.com/a?b=1&c=2)\n[x](https://e.com" onclick="evil)');
    // Dangerous text may appear, but only escaped: never as a tag, attribute or link target.
    expect(html).not.toMatch(/<(img|script)|<[^>]*\sonerror=|href="(javascript|data):|<a [^>]*onclick/i);
    expect([...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1])).toEqual(["https://example.com/a?b=1&amp;c=2"]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2">ok</a>');
  });

  it("shows mentions as text and handles empty input", () => {
    expect(renderMarkdownLite("hi [@Ann](mention:u1)")).toContain('<span class="mention">@Ann</span>');
    expect(renderMarkdownLite(null)).toBe("");
    expect(renderMarkdownLite("")).toBe("");
  });
});
