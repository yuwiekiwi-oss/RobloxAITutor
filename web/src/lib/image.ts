// Shrinks screenshots before upload: keeps text readable but avoids multi-MB PNGs.

const MAX_SIDE = 1920;
const KEEP_ORIGINAL_BYTES = 1_500_000;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED.includes(file.type);
}

export async function prepareScreenshot(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_ORIGINAL_BYTES && file.type !== "image/gif") {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp", 0.9);
  if (webp && webp.type === "image/webp") return webp;
  return (await toBlob("image/jpeg", 0.88)) ?? file;
}

/** Image files from a paste / drop event. */
export function imagesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f && isAcceptedImage(f)) files.push(f);
    }
  }
  if (files.length === 0) {
    for (const f of Array.from(dt.files ?? [])) if (isAcceptedImage(f)) files.push(f);
  }
  return files;
}
