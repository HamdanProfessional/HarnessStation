/*
 * Generate subtitles + scripts from the decks, so they never drift out of sync.
 *
 * For each E0x deck it reads every slide's data-narration and data-seconds (the
 * timing the voiceover should take on that slide) and emits, per lecture:
 *   subtitles/E0x.vtt   WebVTT captions, timed, sentence-split
 *   subtitles/E0x.srt   the same as SRT
 *   scripts/E0x-narration.txt   the plain voiceover script (for TTS)
 *   storyboards/E0x.md          slide-by-slide: narration + on-screen action
 *
 * Run:  node course/assets/build-subtitles.mjs
 *
 * The plan: record the screen silent, pacing each slide to data-seconds (press A
 * in the deck to auto-advance at exactly that pace). Then generate voice from the
 * narration script and drop the .vtt on the timeline — it already lines up.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
for (const d of ["subtitles", "scripts", "storyboards"]) mkdirSync(join(root, d), { recursive: true });

const decks = readdirSync(root).filter((f) => /^E\d\d-.*\.html$/.test(f)).sort();

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .trim();

/** Pull ordered slides with their narration + seconds from a deck's HTML. */
function parseSlides(html) {
  const slides = [];
  const re = /<section class="slide[^"]*"([\s\S]*?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const narr = /data-narration="([\s\S]*?)"/.exec(attrs);
    const secs = /data-seconds="(\d+)"/.exec(attrs);
    const cue = /data-cue="([\s\S]*?)"/.exec(attrs);
    slides.push({
      narration: narr ? decode(narr[1]) : "",
      seconds: secs ? Number(secs[1]) : 6,
      cue: cue ? decode(cue[1]) : "",
    });
  }
  return slides;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(t, sep) {
  const ms = Math.round((t % 1) * 1000);
  const s = Math.floor(t) % 60;
  const mm = Math.floor(t / 60) % 60;
  const hh = Math.floor(t / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

/** Split a slide's narration into sentence cues, timed within its window. */
function cuesFor(slides) {
  const cues = [];
  let t = 0;
  for (const slide of slides) {
    const start = t;
    const end = t + slide.seconds;
    t = end;
    const sentences = (slide.narration.match(/[^.!?]+[.!?]*/g) || [slide.narration])
      .map((x) => x.trim())
      .filter(Boolean);
    if (!sentences.length) continue;
    const total = sentences.reduce((a, s) => a + s.length, 0) || 1;
    let cursor = start;
    sentences.forEach((text, idx) => {
      const share = (sentences[idx].length / total) * (end - start);
      const cStart = cursor;
      const cEnd = idx === sentences.length - 1 ? end : Math.min(end, cursor + share);
      cursor = cEnd;
      cues.push({ start: cStart, end: cEnd, text });
    });
  }
  return cues;
}

for (const file of decks) {
  const id = file.slice(0, 3); // E0x
  const html = readFileSync(join(root, file), "utf8");
  const slides = parseSlides(html);
  const cues = cuesFor(slides);

  // VTT
  let vtt = "WEBVTT\n\n";
  cues.forEach((c, i) => {
    vtt += `${i + 1}\n${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n\n`;
  });
  writeFileSync(join(root, "subtitles", `${id}.vtt`), vtt);

  // SRT
  let srt = "";
  cues.forEach((c, i) => {
    srt += `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n\n`;
  });
  writeFileSync(join(root, "subtitles", `${id}.srt`), srt);

  // Narration script (for TTS)
  const script = slides.map((s, i) => `# Slide ${i + 1}\n${s.narration}`).filter((s) => !s.endsWith("\n")).join("\n\n");
  writeFileSync(join(root, "scripts", `${id}-narration.txt`), script + "\n");

  // Storyboard
  const title = (/<title>(.*?)<\/title>/.exec(html) || [, id])[1];
  const runtime = slides.reduce((a, s) => a + s.seconds, 0);
  let sb = `# ${title}\n\n*Estimated voiceover runtime: ${Math.floor(runtime / 60)}m ${runtime % 60}s. Generated from the deck — edit the deck, then re-run build-subtitles.mjs.*\n\n`;
  slides.forEach((s, i) => {
    sb += `## Slide ${i + 1} · ~${s.seconds}s\n\n`;
    sb += `**Narration:** ${s.narration || "(none)"}\n\n`;
    if (s.cue) sb += `**On screen / action:** ${s.cue}\n\n`;
  });
  writeFileSync(join(root, "storyboards", `${id}.md`), sb);

  console.log(`${id}: ${slides.length} slides, ${cues.length} cues, ~${runtime}s`);
}
console.log("Done.");
