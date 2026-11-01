const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only absolute http(s) links are ever made clickable. */
const safeUrl = (u: string) => /^https?:\/\/[^\s"'<>]+$/i.test(u);

function inline(text: string): string {
  const parts = text.split(/(`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${esc(part.slice(1, -1))}</code>`;
      let out = esc(part);
      out = out.replace(/\[@([^\]]+)\]\(mention:[^)]+\)/g, '<span class="mention">@$1</span>');
      out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label: string, url: string) => (safeUrl(url.replace(/&amp;/g, "&")) ? `<a href="${url}">${label}</a>` : label));
      out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(?<![\w*])_([^_\n]+)_(?![\w*])/g, "<em>$1</em>");
      return out;
    })
    .join("");
}

/**
 * A deliberately small markdown renderer for the task view: headings, lists, quotes, code blocks,
 * inline code, bold, italics and http(s) links. Everything is escaped first, and nothing but those
 * elements can come out, so task text can never inject markup or script into the webview.
 */
export function renderMarkdownLite(md: string | null | undefined): string {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      closeList();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      html.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
      html.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
      continue;
    }
    closeList();
    if (heading) html.push(`<h${Math.min(6, heading[1].length + 2)}>${inline(heading[2])}</h${Math.min(6, heading[1].length + 2)}>`);
    else if (line.startsWith(">")) html.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    else if (line.trim() === "") html.push("");
    else html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== "")).join("\n").trim();
}
