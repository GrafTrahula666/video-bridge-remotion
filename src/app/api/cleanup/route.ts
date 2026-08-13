import { del, list } from "@vercel/blob";
import { FILE_TTL_MS } from "@/lib/config";
import { jsonError } from "@/lib/http";
import { hasValidCronSecret } from "@/lib/security";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    if (!hasValidCronSecret(request)) return jsonError("Unauthorized", 401);

    const cutoff = Date.now() - FILE_TTL_MS;
    let cursor: string | undefined;
    let scanned = 0;
    let deleted = 0;

    do {
      const page = await list({ prefix: "uploads/", limit: 1000, cursor });
      scanned += page.blobs.length;
      const expiredUrls = page.blobs
        .filter((blob) => blob.uploadedAt.getTime() <= cutoff)
        .map((blob) => blob.url);

      for (let index = 0; index < expiredUrls.length; index += 100) {
        const batch = expiredUrls.slice(index, index + 100);
        await del(batch);
        deleted += batch.length;
      }

      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return Response.json({ ok: true, scanned, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed";
    return jsonError(message, 500);
  }
}
