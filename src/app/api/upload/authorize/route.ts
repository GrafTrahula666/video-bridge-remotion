import { randomUUID } from "node:crypto";
import { FILE_TTL_MS } from "@/lib/config";
import { enforceRateLimit, jsonError } from "@/lib/http";
import { hasValidAccessKey, signDeletion } from "@/lib/security";
import { validateVideoFile } from "@/lib/video";

type AuthorizeBody = {
  filename?: unknown;
  mimeType?: unknown;
  size?: unknown;
};

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit(request, "authorize", 12);
    if (limited) return limited;
    if (!hasValidAccessKey(request)) return jsonError("Неверный код доступа.", 401);

    const body = (await request.json()) as AuthorizeBody;
    if (
      typeof body.filename !== "string" ||
      typeof body.mimeType !== "string" ||
      typeof body.size !== "number"
    ) {
      return jsonError("Некорректные параметры файла.", 400);
    }

    const { extension, mimeType } = validateVideoFile({
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.size,
    });
    const now = new Date();
    const datePrefix = now.toISOString().slice(0, 10);
    const pathname = `uploads/${datePrefix}/${randomUUID()}/source-video.${extension}`;
    const expiresAt = new Date(now.getTime() + FILE_TTL_MS).toISOString();
    const deleteToken = signDeletion(pathname, expiresAt);

    return Response.json({ pathname, expiresAt, deleteToken, mimeType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось разрешить загрузку.";
    return jsonError(message, 400);
  }
}
