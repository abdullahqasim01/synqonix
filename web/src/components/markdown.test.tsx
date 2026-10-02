import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Markdown } from "./markdown";

it("renders markdown, code blocks and tables", () => {
  const { container } = render(<Markdown>{"**bold** and `code`\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |"}</Markdown>);
  expect(screen.getByText("bold").tagName).toBe("STRONG");
  expect(container.querySelector("pre code")?.textContent).toContain("const a = 1;");
  expect(container.querySelector("table")).not.toBeNull();
});

it("never renders raw HTML or executable URLs", () => {
  const { container } = render(
    <Markdown>{'<img src=x onerror="alert(1)"><script>alert(2)</script>\n\n[click](javascript:alert(3))\n\n[ok](https://example.com)'}</Markdown>,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  const links = [...container.querySelectorAll("a")];
  expect(links.some((a) => a.getAttribute("href")?.startsWith("javascript:"))).toBe(false);
  const ok = links.find((a) => a.getAttribute("href") === "https://example.com")!;
  expect(ok.getAttribute("rel")).toContain("noopener");
  expect(ok.getAttribute("target")).toBe("_blank");
});

it("renders mentions as highlighted text, not links", () => {
  const { container } = render(<Markdown>{"hi [@Ann](mention:11111111-aaaa)"}</Markdown>);
  expect(screen.getByText("@Ann")).toBeInTheDocument();
  expect(container.querySelector('a[href^="mention:"]')).toBeNull();
});

it("keeps links inside the app in the same tab", () => {
  const { container } = render(<Markdown>{"[SYN-1](/w/abc/tasks/SYN-1)"}</Markdown>);
  const a = container.querySelector("a")!;
  expect(a.getAttribute("href")).toBe("/w/abc/tasks/SYN-1");
  expect(a.getAttribute("target")).toBeNull();
});
