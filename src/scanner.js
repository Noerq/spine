// Live barcode scanning via the camera. Safari has no BarcodeDetector,
// so we decode frames with zxing-wasm (WebAssembly, self-hosted).

import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { isValidIsbn13 } from "./isbn.js";

prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

const READER_OPTIONS = { formats: ["EAN-13"], tryHarder: true, maxNumberOfSymbols: 1 };

/**
 * Starts the camera in `video` and calls onIsbn(isbn) once a valid ISBN is read.
 * Returns a stop() function.
 */
export async function startScanner(video, onIsbn) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let running = true;
  let timer;

  const tick = async () => {
    if (!running) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      // Decode only the middle band, where the on-screen guide is.
      const cropH = Math.round(h * 0.5);
      canvas.width = w;
      canvas.height = cropH;
      ctx.drawImage(video, 0, (h - cropH) / 2, w, cropH, 0, 0, w, cropH);
      try {
        const [hit] = await readBarcodes(ctx.getImageData(0, 0, w, cropH), READER_OPTIONS);
        if (running && hit?.isValid && isValidIsbn13(hit.text)) {
          stop();
          navigator.vibrate?.(60);
          onIsbn(hit.text);
          return;
        }
      } catch (e) {
        console.warn("decode", e);
      }
    }
    timer = setTimeout(tick, 120);
  };

  function stop() {
    running = false;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  tick();
  return stop;
}
