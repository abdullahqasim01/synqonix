"use client";

import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders user-written markdown. Raw HTML is never rendered (react-markdown escapes it), and
 * only safe URL schemes are allowed — important because auth tokens live in localStorage.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-sx text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("mention:") ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children }) {
            if (href?.startsWith("mention:")) {
              return <span className="rounded bg-primary/10 px-1 font-medium text-primary">{children}</span>;
            }
            // Links inside the app (task keys in chat) stay in the same tab.
            if (href?.startsWith("/") && !href.startsWith("//")) return <Link href={href} className="text-primary underline">{children}</Link>;
            return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">{children}</a>;
          },
          code({ className, children }) {
            const block = /language-/.test(className ?? "");
            return block
              ? <code className={cn("font-mono text-xs", className)}>{children}</code>
              : <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
          },
          pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3">{children}</pre>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1 mt-3 font-semibold">{children}</h4>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
          table: ({ children }) => <table className="my-2 w-full border-collapse text-xs">{children}</table>,
          th: ({ children }) => <th className="border border-border bg-muted px-2 py-1 text-left">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
