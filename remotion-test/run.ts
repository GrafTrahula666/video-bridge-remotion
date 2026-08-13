import chromium from "@sparticuz/chromium";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import type { VideoBridgeTestProps } from "./Composition";

type Probe = {
  streams: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }>;
  format: { duration?: string; size?: string; format_name?: string };
};

function ensureLoopbackInterfaceForRestrictedSandboxes() {
  try {
    os.networkInterfaces();
  } catch {
    Object.defineProperty(os, "networkInterfaces", {
      configurable: true,
      value: () => ({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
      }),
    });
  }
}

function extensionFor(url: string, contentType: string): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if ([".mp4", ".mov", ".webm"].includes(fromUrl)) return fromUrl;
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("quicktime")) return ".mov";
  return ".mp4";
}

function assertSourceUrl(value: string): URL {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("VIDEO_URL must use HTTPS (HTTP is allowed only for the local QA server).");
  }
  return url;
}

async function probeVideo(path: string): Promise<Probe> {
  return new Promise((resolveProbe, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${stderr}`));
      resolveProbe(JSON.parse(stdout) as Probe);
    });
  });
}

async function main() {
  const rawUrl = process.env.VIDEO_URL;
  if (!rawUrl) throw new Error("Set VIDEO_URL=https://.../source-video.mp4");
  const sourceUrl = assertSourceUrl(rawUrl);
  const testRoot = resolve(process.cwd(), "remotion-test");
  const publicDir = join(testRoot, "public");
  const inputDir = join(publicDir, "input");
  const outputDir = join(testRoot, "output");
  await rm(inputDir, { recursive: true, force: true });
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const head = await fetch(sourceUrl, { method: "HEAD", redirect: "error" });
  if (!head.ok) throw new Error(`Direct HEAD failed: HTTP ${head.status}`);
  const headType = head.headers.get("content-type") || "";
  if (!headType.toLowerCase().startsWith("video/")) {
    throw new Error(`Direct URL did not return video Content-Type: ${headType || "missing"}`);
  }

  const extension = extensionFor(sourceUrl.toString(), headType);
  const sourceFilename = `source-video${extension}`;
  const sourcePath = join(inputDir, sourceFilename);
  const response = await fetch(sourceUrl, { redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`Direct GET failed: HTTP ${response.status}`);
  const getType = response.headers.get("content-type") || "";
  if (!getType.toLowerCase().startsWith("video/")) throw new Error(`GET returned ${getType || "no Content-Type"}`);
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
    createWriteStream(sourcePath, { flags: "wx" }),
  );

  const downloaded = await stat(sourcePath);
  const expectedLength = Number(head.headers.get("content-length"));
  if (Number.isFinite(expectedLength) && expectedLength > 0 && downloaded.size !== expectedLength) {
    throw new Error(`Download size mismatch: expected ${expectedLength}, got ${downloaded.size}`);
  }

  const probe = await probeVideo(sourcePath);
  const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
  if (!videoStream?.width || !videoStream.height) throw new Error("ffprobe did not find a readable video stream");
  const duration = Number(probe.format.duration || 0);
  const inputProps: VideoBridgeTestProps = {
    sourceFilename,
    durationInFrames: Math.max(1, Math.min(90, Math.floor(duration * 30) || 90)),
    sourceWidth: videoStream.width,
    sourceHeight: videoStream.height,
  };

  ensureLoopbackInterfaceForRestrictedSandboxes();
  const serveUrl = await bundle({
    entryPoint: join(testRoot, "index.ts"),
    publicDir,
    webpackOverride: (configuration) => configuration,
  });
  const browserExecutable = await chromium.executablePath();
  const composition = await selectComposition({
    serveUrl,
    id: "VideoBridgeCompatibility",
    inputProps,
    browserExecutable,
    chromeMode: "headless-shell",
  });
  const outputLocation = join(outputDir, "videobridge-remotion-test.mp4");
  await rm(outputLocation, { force: true });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    browserExecutable,
    chromeMode: "headless-shell",
    concurrency: 1,
    overwrite: true,
  });
  const rendered = await stat(outputLocation);
  const renderedProbe = await probeVideo(outputLocation);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    source: {
      url: sourceUrl.toString(),
      filename: basename(sourcePath),
      bytes: downloaded.size,
      contentType: getType,
      duration,
      width: videoStream.width,
      height: videoStream.height,
      fps: videoStream.r_frame_rate,
      codec: videoStream.codec_name,
      container: probe.format.format_name,
    },
    render: {
      output: outputLocation,
      bytes: rendered.size,
      duration: renderedProbe.format.duration,
      codec: renderedProbe.streams.find((stream) => stream.codec_type === "video")?.codec_name,
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
