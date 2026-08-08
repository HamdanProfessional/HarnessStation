// HarnessStation marketing site — shared behaviour (reveal, marquee, tilt).
document.documentElement.classList.add("js");

const reveal = (el) => el.classList.add("in");
const all = () => document.querySelectorAll("[data-reveal]").forEach(reveal);
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
  window.addEventListener("load", () => setTimeout(all, 1600));
} else { all(); }

// Seamless marquee loop (only on pages that have one).
const track = document.getElementById("track");
if (track) track.innerHTML += track.innerHTML;

// Cheap 3D tilt on the hero mock (GPU transform only), fine pointers, motion allowed.
const wrap = document.querySelector(".mock-wrap");
const mock = document.getElementById("mock");
if (wrap && mock && matchMedia("(pointer:fine)").matches && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
  let raf = 0;
  wrap.addEventListener("pointermove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = wrap.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      mock.style.setProperty("--ry", (px * 10).toFixed(2) + "deg");
      mock.style.setProperty("--rx", (-py * 10).toFixed(2) + "deg");
    });
  });
  wrap.addEventListener("pointerleave", () => { mock.style.setProperty("--ry", "0deg"); mock.style.setProperty("--rx", "0deg"); });
}
