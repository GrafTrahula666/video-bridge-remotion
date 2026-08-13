import { del } from "@vercel/blob";
import { enforceRateLimit, jsonError } from "@/lib/http";
import { hasValidDeletionSignature } from "@/lib/security";
import { isVideoBridgeBlobUrl, pathnameFromBlobUrl } from "@/lib/video";

type DeleteBody = {
  url?: unknown;
  expiresAt?: unknown;
  deleteToken?: unknown;
};

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit(request, "delete", 30);
    if (limited) return limited;
    const body = (await request.json()) as DeleteBody;
    if (
      typeof body.url !== "string" ||
      typeof body.expiresAt !== "string" ||
      typeof body.deleteToken !== "string" ||
      !isVideoBridgeBlobUrl(body.url)
    ) {
      return jsonError("Некорректный запрос на удаление.", 400);
    }

    const pathname = pathnameFromBlobUrl(body.url);
    if (!hasValidDeletionSignature(pathname, body.expiresAt, body.deleteToken)) {
      return jsonError("Нет права на удаление этого файла.", 403);
    }

    await del(body.url);
    return Response.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить файл.";
    return jsonError(message, 500);
  }
}
