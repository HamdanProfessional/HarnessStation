import type { Attachment } from "./types";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_TEXT = 200_000; // chars

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsText(file);
  });
}

/** Convert a picked File into an Attachment (image data-url, or extracted text). */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (IMAGE_TYPES.includes(file.type)) {
    return { kind: "image", name: file.name, mime: file.type, data: await readAsDataUrl(file) };
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const text = await extractPdfText(file);
    return { kind: "text", name: file.name, mime: "application/pdf", data: text.slice(0, MAX_TEXT) };
  }
  // treat everything else as text (code, md, csv, json, txt...)
  const text = await readAsText(file);
  return { kind: "text", name: file.name, mime: file.type || "text/plain", data: text.slice(0, MAX_TEXT) };
}

/** Minimal PDF text extraction: pull text runs from content streams without a heavy library. */
async function extractPdfText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // decode latin1 so byte values map 1:1 to chars
  let raw = "";
  for (let i = 0; i < buf.length; i++) raw += String.fromCharCode(buf[i]);
  const chunks: string[] = [];
  // text shown via ( ) Tj / TJ operators
  const re = /\(((?:\\.|[^\\()])*)\)\s*T[jJ]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    chunks.push(m[1].replace(/\\([()\\])/g, "$1").replace(/\\n/g, "\n"));
  }
  const text = chunks.join(" ").replace(/\s+\n/g, "\n").trim();
  return text || "[Could not extract text from this PDF — it may be scanned/image-only.]";
}

/** Detect a full HTML document in an assistant message (```html block or <html>/<!doctype>). */
export function extractHtml(content: string): string | null {
  const fence = /```(?:html)\n([\s\S]*?)```/i.exec(content);
  const candidate = fence ? fence[1] : content;
  if (/<!doctype html/i.test(candidate) || /<html[\s>]/i.test(candidate)) {
    // if it came from a fence, use that; else use the whole thing
    return fence ? fence[1].trim() : candidate.trim();
  }
  // also catch an html fence that is just a body fragment
  if (fence && /<(div|body|canvas|svg|button|h1|p|style|script)[\s>]/i.test(fence[1])) {
    return fence[1].trim();
  }
  return null;
}

/** A renderable artifact found in an assistant message. */
export interface Artifact {
  kind: "html" | "svg";
  code: string;
}

/** Detect a standalone ```svg block (or a bare <svg> document). */
function extractSvg(content: string): string | null {
  const fence = /```(?:svg|xml)\n([\s\S]*?)```/i.exec(content);
  const candidate = (fence ? fence[1] : content).trim();
  // Require the message to be essentially just the SVG — prose that happens to
  // mention <svg> shouldn't open a canvas.
  if (/^<\?xml[\s\S]*?<svg[\s>]/i.test(candidate) || /^<svg[\s>]/i.test(candidate)) {
    return candidate.endsWith("</svg>") ? candidate : null;
  }
  return null;
}

/**
 * Find the renderable artifact in an assistant message, if any.
 * SVG is checked first: an `<svg>` document would otherwise be swallowed by the
 * HTML fragment rule and rendered as a bare body.
 */
export function extractArtifact(content: string): Artifact | null {
  const svg = extractSvg(content);
  if (svg) return { kind: "svg", code: svg };
  const html = extractHtml(content);
  return html ? { kind: "html", code: html } : null;
}
