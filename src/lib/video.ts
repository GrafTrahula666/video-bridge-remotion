import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_VIDEO_TYPES,
  type SupportedExtension,
} from "@/lib/config";

export type VideoValidationInput = {
  filename: string;
  mimeType: string;
  size: number;
};

export type VideoValidationResult = {
  extension: SupportedExtension;
  mimeType: string;
};

export function getExtension(filename: string): string {
  const cleanName = filename.trim();
  const dotIndex = cleanName.lastIndexOf(".");
  return dotIndex === -1 ? "" : cleanName.slice(dotIndex + 1).toLowerCase();
}

export function validateVideoFile(
  input: VideoValidationInput,
): VideoValidationResult {
  const extension = getExtension(input.filename) as SupportedExtension;

  if (!(extension in SUPPORTED_VIDEO_TYPES)) {
    throw new Error("Разрешены только MP4, MOV и WebM.");
  }

  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new Error("Файл пустой или имеет некорректный размер.");
  }

  if (input.size > MAX_UPLOAD_BYTES) {
    throw new Error("Файл превышает лимит 1 ГБ.");
  }

  const normalizedMime = input.mimeType.trim().toLowerCase();
  const allowedMimeTypes = SUPPORTED_VIDEO_TYPES[extension] as readonly string[];
  if (!allowedMimeTypes.includes(normalizedMime)) {
    throw new Error(
      `Формат файла и MIME-тип не совпадают (${extension.toUpperCase()} / ${normalizedMime || "не указан"}).`,
    );
  }

  return { extension, mimeType: normalizedMime };
}

export function isVideoBridgeBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".blob.vercel-storage.com") &&
      url.pathname.startsWith("/uploads/")
    );
  } catch {
    return false;
  }
}

export function pathnameFromBlobUrl(value: string): string {
  if (!isVideoBridgeBlobUrl(value)) {
    throw new Error("Недопустимый Blob URL.");
  }
  return decodeURIComponent(new URL(value).pathname.slice(1));
}
