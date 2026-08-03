/*
 * HarnessStation course — slideshow engine.
 *
 * Dependency-free. Each deck is a list of .slide elements inside .canvas. A slide
 * may carry:
 *   data-narration="…"  the voiceover line (shown as a caption / in notes / used
 *                        to generate the .vtt via export.js)
 *   data-seconds="8"     how long the eventual VO on this slide runs, so autoplay
 *                        can pace the silent screen take to match the voice track
 *   data-cue="…"         a director action (switch to the app, click X) — shown
 *                        only in presenter mode, never in the recording
 *
 * Keys:
 *   → / Space / PageDown   next        ← / PageUp   previous
 *   Home / End             first/last  F            fullscreen
 *   C                      captions on/off (burn-in the narration line)
 *   N                      presenter mode (notes + director cues, off-screen)
 *   A                      autoplay using data-seconds (to time the silent take)
 */
(function () {
  const canvas = document.querySelector(".canvas");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const bar = document.querySelector(".bar");
  const counter = document.querySelector(".counter");
  const captions = document.querySelector(".captions");
  const cueEl = document.querySelector(".cue");
  const notesNarr = document.querySelector(".notes .n-narr");
  const notesCue = document.querySelector(".notes .n-cue");
  let i = 0;
  let autoplay = false;
  let timer = null;

  // Scale the fixed 1920×1080 canvas to fit the window (keeps recording crisp at
  // any window size; record fullscreen for exact 1080p).
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    canvas.style.transform = `scale(${s})`;
  }
  window.addEventListener("resize", fit);
  fit();

  function render() {
    slides.forEach((s, n) => s.classList.toggle("current", n === i));
    const cur = slides[i];
    bar.style.width = `${((i + 1) / slides.length) * 100}%`;
    counter.textContent = `${i + 1} / ${slides.length}`;
    const narr = cur.dataset.narration || "";
    const cue = cur.dataset.cue || "";
    captions.textContent = narr;
    cueEl.textContent = cue;
    cueEl.classList.toggle("has", !!cue);
    if (notesNarr) notesNarr.textContent = narr || "(no narration)";
    if (notesCue) notesCue.textContent = cue || "(no action)";
    if (autoplay) schedule();
  }

  function go(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    render();
  }
  const next = () => go(i + 1);
  const prev = () => go(i - 1);

  function schedule() {
    clearTimeout(timer);
    const secs = Number(slides[i].dataset.seconds || 6);
    if (i < slides.length - 1) timer = setTimeout(next, secs * 1000);
    else autoplay = false;
  }

  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowRight":
      case " ":
      case "PageDown":
        e.preventDefault(); next(); break;
      case "ArrowLeft":
      case "PageUp":
        e.preventDefault(); prev(); break;
      case "Home": go(0); break;
      case "End": go(slides.length - 1); break;
      case "f": case "F":
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
      case "c": case "C": captions.classList.toggle("on"); break;
      case "n": case "N": document.body.classList.toggle("presenter"); break;
      case "a": case "A":
        autoplay = !autoplay;
        if (autoplay) schedule(); else clearTimeout(timer);
        break;
    }
  });

  // Click the right two-thirds to advance, left third to go back — handy when
  // recording one-handed.
  canvas.addEventListener("click", (e) => {
    const x = e.clientX / window.innerWidth;
    x < 0.33 ? prev() : next();
  });

  render();
})();
