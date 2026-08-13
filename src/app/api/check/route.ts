import { enforceRateLimit, jsonError } from "@/lib/http";
import { hasValidAccessKey } from "@/lib/security";
import { isVideoBridgeBlobUrl } from "@/lib/video";

type CheckBody = { url?: unknown };

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit(request, "check", 40);
    if (limited) return limited;
    if (!hasValidAccessKey(request)) return jsonError("Неверный код доступа.", 401);

    const body = (await request.json()) as CheckBody;
    if (typeof body.url !== "string" || !isVideoBridgeBlobUrl(body.url)) {
      return jsonError("Разрешены только ссылки VideoBridge Blob.", 400);
    }

    const headResponse = await fetch(body.url, {
      method: "HEAD",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const sampleResponse = await fetch(body.url, {
      headers: { Range: "bytes=0-511" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const contentType =
      headResponse.headers.get("content-type") ??
      sampleResponse.headers.get("content-type") ??
      "";
    const contentLength = headResponse.headers.get("content-length");
    const firstBytes = new Uint8Array(await sampleResponse.arrayBuffer());
    const textPrefix = new TextDecoder("utf-8", { fatal: false })
      .decode(firstBytes.slice(0, 96))
      .trimStart()
      .toLowerCase();
    const looksLikeHtml =
      contentType.toLowerCase().includes("text/html") ||
      textPrefix.startsWith("<!doctype html") ||
      textPrefix.startsWith("<html");
    const successful = headResponse.ok && sampleResponse.ok;
    const videoContentType = contentType.toLowerCase().startsWith("video/");
    const directAccess = successful && videoContentType && !looksLikeHtml;

    return Response.json({
      directAccess,
      status: headResponse.status,
      rangeStatus: sampleResponse.status,
      contentType,
      contentLength: contentLength ? Number(contentLength) : null,
      looksLikeHtml,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить ссылку.";
    return jsonError(message, 502);
  }
}
