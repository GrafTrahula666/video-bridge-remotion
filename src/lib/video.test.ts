import { describe, expect, it } from "vitest";
import {
  getExtension,
  isVideoBridgeBlobUrl,
  pathnameFromBlobUrl,
  validateVideoFile,
} from "@/lib/video";

describe("video validation", () => {
  it("accepts supported video extension and MIME pairs", () => {
    expect(validateVideoFile({ filename: "iPhone.MOV", mimeType: "video/quicktime", size: 42 })).toEqual({
      extension: "mov",
      mimeType: "video/quicktime",
    });
    expect(validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", size: 42 }).extension).toBe("mp4");
    expect(validateVideoFile({ filename: "clip.webm", mimeType: "video/webm", size: 42 }).extension).toBe("webm");
  });

  it("rejects mismatched and unsupported formats", () => {
    expect(() => validateVideoFile({ filename: "clip.mp4", mimeType: "text/html", size: 42 })).toThrow(/MIME/);
    expect(() => validateVideoFile({ filename: "clip.exe", mimeType: "video/mp4", size: 42 })).toThrow(/MP4/);
    expect(() => validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", size: 0 })).toThrow(/пустой/);
  });

  it("recognizes only namespaced public Blob URLs", () => {
    const url = "https://store.public.blob.vercel-storage.com/uploads/2026-08-13/id/source-video.mp4";
    expect(isVideoBridgeBlobUrl(url)).toBe(true);
    expect(pathnameFromBlobUrl(url)).toBe("uploads/2026-08-13/id/source-video.mp4");
    expect(isVideoBridgeBlobUrl("https://example.com/uploads/source-video.mp4")).toBe(false);
    expect(isVideoBridgeBlobUrl("https://store.public.blob.vercel-storage.com/private/file.mp4")).toBe(false);
  });

  it("extracts lowercase extensions", () => {
    expect(getExtension("My.Video.MP4")).toBe("mp4");
  });
});
