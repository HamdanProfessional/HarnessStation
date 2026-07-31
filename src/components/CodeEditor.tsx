import { useMemo, useRef } from "react";
// Core + the three grammars this editor is ever asked for. The default
// "highlight.js" entry point registers ~190 languages (~900 kB) — nearly all of
// them dead weight here. Unregistered languages fall back to plain escaped text.
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);

interface Props {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  minRows?: number;
  readOnly?: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function CodeEditor({ value, onChange, language = "plaintext", minRows = 6, readOnly }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(value, { language }).value;
      }
    } catch {
      /* fall through */
    }
    return escapeHtml(value);
  }, [value, language]);

  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "    " + value.slice(end);
      onChange?.(next);
      requestAnimationFrame(() => ta.setSelectionRange(start + 4, start + 4));
    } else if (e.key === "Enter") {
      // keep current indentation on new lines
      e.preventDefault();
      const start = ta.selectionStart;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const indent = (value.slice(lineStart, start).match(/^[ \t]*/) ?? [""])[0];
      const extra = /[:{([]\s*$/.test(value.slice(lineStart, start)) ? "    " : "";
      const ins = "\n" + indent + extra;
      const next = value.slice(0, start) + ins + value.slice(ta.selectionEnd);
      onChange?.(next);
      const pos = start + ins.length;
      requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
    }
  };

  return (
    <div className="code-editor" style={{ minHeight: `${minRows * 1.55 + 1.4}em` }}>
      <pre ref={preRef} className="code-editor-pre" aria-hidden="true">
        <code
          className={`hljs language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
        />
      </pre>
      <textarea
        ref={taRef}
        className="code-editor-ta"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
