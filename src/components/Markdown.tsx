import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";
import { Mermaid } from "./Mermaid";

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
 * The naive render is `dangerouslySetInnerHTML`, and that was here for a
 * while — but model output is untrusted input (it echoes fetched pages, RAG
 * documents, tool results), and raw SVG accepts `<script>`, `onload=`-style
 * attributes and `<foreignObject>` full of HTML. In a Tauri webview an XSS is
 * not "defaced chat": the page can reach every `invoke()` command. So the SVG
 * is never given to the DOM as markup. Base64-packed into an `<img>` it becomes
 * a sealed document: images don't run scripts, don't fire event handlers,
 * don't load external references and don't render foreignObject. Same picture,
 * none of the attack surface — which is why this beats sanitizing: there is no
 * allowlist to maintain and nothing subtle to get wrong.
 */
export function svgDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/**
 * Memoised on `children`, which is the whole prop surface.
 *
 * Every assistant token restreams the open message, and the store update
 * re-renders the entire transcript. Without this, a 60-message conversation
 * re-parsed 60 markdown documents and re-ran syntax highlighting over every
 * code block in them, per token. The one message whose text actually changed
 * still re-renders; the other 59 now bail out on a string compare.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
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
            if (lang === "mermaid") return <Mermaid code={text.replace(/\n$/, "")} />;
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
});
