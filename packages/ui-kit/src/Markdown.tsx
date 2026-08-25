import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const text = String(children);
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-lang">{lang ?? "code"}</span>
        <button
          className="code-copy"
          onClick={() => {
            void navigator.clipboard.writeText(text.replace(/\n$/, ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/**
 * An SVG preview that cannot execute.
 *
 * Twin of the fix in the app's src/components/Markdown.tsx: model output is
 * untrusted (it echoes fetched pages, RAG docs, tool results), and raw SVG
 * accepts `<script>`, event attributes and `<foreignObject>`. Sealed into an
 * `<img>` it becomes a document that cannot run any of it. Kept as a copy —
 * this package is dependency-free and cannot import from the app.
 */
export function svgDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children, ...props }) {
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            const text = String(children);
            const isBlock = /language-/.test(className ?? "") || text.includes("\n");
            if (!isBlock) {
              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            }
            if (lang === "svg" && /<svg[\s>]/i.test(text)) {
              return <img className="svg-render" src={svgDataUrl(text)} alt="SVG preview" />;
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
