export const ONE_MIB = 1024 * 1024;
export const MAX_UPLOAD_BYTES = 1024 * ONE_MIB;
export const MULTIPART_THRESHOLD_BYTES = 100 * ONE_MIB;
export const FILE_TTL_MS = 24 * 60 * 60 * 1000;

export const SUPPORTED_VIDEO_TYPES = {
  mp4: ["video/mp4", "application/mp4"],
  mov: ["video/quicktime", "video/mov"],
  webm: ["video/webm"],
} as const;

export type SupportedExtension = keyof typeof SUPPORTED_VIDEO_TYPES;

export function readServerSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required server configuration: ${name}`);
  }
  return value;
}
