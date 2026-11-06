// Nén ảnh: cạnh dài tối đa 1280px, JPEG, cố gắng <= ~300KB
export async function compressImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không xử lý được ảnh.");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const toBlob = (q: number) => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Không nén được ảnh."))), "image/jpeg", q));
  let blob = await toBlob(0.8);
  for (const q of [0.7, 0.6, 0.5, 0.4]) { if (blob.size <= 300_000) break; blob = await toBlob(q); }
  return blob;
}
