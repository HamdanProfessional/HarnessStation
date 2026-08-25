/**
 * Loudness of the voice that is actually playing, measured from the audio
 * graph rather than guessed.
 *
 * This is what makes real lip-sync possible on the data-URL engines (Kokoro,
 * Piper, WinRT data-URL, cloud TTS): their playback runs through an
 * <audio> element we own, so an AnalyserNode can watch it. The native SAPI
 * engine synthesizes and plays inside Rust with no element to analyse — for
 * that path the caller gets null and the motion driver falls back to its
 * synthetic envelope, exactly as before.
 */

/**
 * Mean level of the voice band of a byte-frequency spectrum, normalized 0..1.
 * Speech energy lives roughly between 85 Hz and 3 kHz; ignoring everything
 * outside makes the mouth respond to the voice rather than to hiss or bass.
 */
export function bandLevel(freq: Uint8Array, sampleRate: number, lo = 85, hi = 3000): number {
  const n = freq.length;
  if (!n || !sampleRate) return 0;
  const binHz = sampleRate / 2 / n;
  const start = Math.max(1, Math.floor(lo / binHz));
  const end = Math.min(n - 1, Math.ceil(hi / binHz));
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    sum += freq[i] * freq[i];
    count++;
  }
  if (!count) return 0;
  // Bytes are 0..255, so /128 maps a strong band to ~1 while leaving headroom.
  return Math.min(1, Math.sqrt(sum / count) / 128);
}
