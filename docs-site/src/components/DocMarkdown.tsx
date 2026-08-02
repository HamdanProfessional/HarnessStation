import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";
import { slugify } from "../content";

/**
 * The markdown renderer.
 *
 * Deliberately the same stack the app itself renders replies with, so a code
 * block or a table looks identical in the docs and in the product. Two things
 * are added that the app has no use for: anchored headings, and callout blocks.
 */

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const text = String(children).replace(/\n$/, "");
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-lang">{lang ?? "code"}</span>
        <button
          className="code-copy"
          onClick={() => {
            void navigator.clipboard.writeText(text);
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

/** Flatten a heading's children to text, so `code` inside a heading still anchors. */
function textOf(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in (node as never)) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function Heading({ level, children }: { level: 2 | 3; children?: ReactNode }) {
  const id = slugify(textOf(children));
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className="doc-heading">
      {children}
      {/* A link on the heading itself, so a reader can cite a section. */}
      <a className="anchor" href={`#${id}`} aria-label={`Link to ${textOf(children)}`}>
        #
      </a>
    </Tag>
  );
}

/**
 * Blockquotes starting with **Note:**, **Warning:** or **Tip:** render as
 * callouts. Markdown has no callout syntax, and inventing a non-standard one
 * would mean the source stops reading as plain markdown everywhere else.
 */
const CALLOUTS = ["note", "warning", "tip"] as const;
type Callout = (typeof CALLOUTS)[number];

function calloutKind(children: ReactNode): Callout | null {
  const lead = textOf(children).trimStart().toLowerCase();
  return CALLOUTS.find((k) => lead.startsWith(`${k}:`)) ?? null;
}

export function DocMarkdown({ children }: { children: string }) {
  return (
    <div className="md doc-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h2: ({ children }) => <Heading level={2}>{children}</Heading>,
          h3: ({ children }) => <Heading level={3}>{children}</Heading>,
          blockquote: ({ children }) => {
            const kind = calloutKind(children);
            return <blockquote className={kind ? `callout callout-${kind}` : undefined}>{children}</blockquote>;
          },
          a: ({ href, children }) => {
            const external = /^https?:/.test(href ?? "");
            return (
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            // Wrapped so a wide table scrolls rather than stretching the column.
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <>{children}</>,
          code({ className, children, ...props }) {
            const text = String(children);
            const isBlock = /language-/.test(className ?? "") || text.includes("\n");
            if (!isBlock) {
              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
