/**
 * Minimal WAV read/write, shared by the mic (writes) and STT (reads).
 *
 * 16-bit PCM mono is all the app's speech pipeline uses, so this handles exactly
 * that rather than pulling in an audio library for one format.
 */

/** Float32 samples in [-1, 1] -> a 16-bit PCM WAV file. */
export function writeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(bytes);
}

/** A 16-bit PCM WAV -> Float32 samples plus its sample rate. */
export function readWav(bytes: Uint8Array): { samples: Float32Array; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rate = view.getUint32(24, true);
  // Walk the chunks to find "data" rather than assuming it's at offset 44 — a
  // WAV written by anything other than this module may carry extra chunks.
  let offset = 12;
  let dataStart = 44;
  let dataLen = bytes.length - 44;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  const count = Math.floor(dataLen / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = view.getInt16(dataStart + i * 2, true) / 0x8000;
  }
  return { samples, rate };
}
