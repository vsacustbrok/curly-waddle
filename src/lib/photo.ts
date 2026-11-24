// Browser-only: shrinking a phone photo before upload.
/** Shrinks a phone photo to at most `max` pixels on the long side, as JPEG, so uploads stay small. */
export async function shrinkPhoto(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", quality));
  if (!blob) throw new Error("This photo could not be read. Please take it again.");
  return blob;
}
