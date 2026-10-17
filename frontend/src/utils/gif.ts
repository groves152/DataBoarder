// Animated GIF of a replay: frames are added as they're captured off the
// viewport canvas, then saved as one file.
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export const GIF_MAX_WIDTH = 720;

/** The canvas scaled down to at most `maxWidth` px wide, as RGBA pixels. */
export function canvasPixels(src: HTMLCanvasElement, maxWidth = GIF_MAX_WIDTH): ImageData {
  const scale = Math.min(1, maxWidth / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const ctx = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d")!;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export class GifRecorder {
  private gif = GIFEncoder();

  /** `delayMs`: how long this frame shows. The GIF loops forever. */
  add(img: ImageData, delayMs: number) {
    const palette = quantize(img.data, 256);
    this.gif.writeFrame(applyPalette(img.data, palette), img.width, img.height, { palette, delay: delayMs, repeat: 0 });
  }

  save(filename: string) {
    this.gif.finish();
    const url = URL.createObjectURL(new Blob([this.gif.bytes()], { type: "image/gif" }));
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
