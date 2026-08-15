import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { start } from "workflow/api";
import { MAX_UPLOAD_BYTES, SUPPORTED_VIDEO_TYPES } from "@/lib/config";
import { enforceRateLimit, jsonError } from "@/lib/http";
import {
  hasValidAccessKey,
  hasValidDeletionSignature,
} from "@/lib/security";
import { getExtension } from "@/lib/video";
import { deleteUploadAtExpiry } from "@/workflows/delete-upload";

type UploadPayload = {
  expiresAt: string;
  deleteToken: string;
};

function parsePayload(value: string | null): UploadPayload {
  if (!value) throw new Error("Отсутствуют данные авторизации загрузки.");
  const parsed = JSON.parse(value) as Partial<UploadPayload>;
  if (typeof parsed.expiresAt !== "string" || typeof parsed.deleteToken !== "string") {
    throw new Error("Некорректные данные авторизации загрузки.");
  }
  return { expiresAt: parsed.expiresAt, deleteToken: parsed.deleteToken };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadPresignedBody;

    if (body.type === "blob.generate-presigned-url") {
      const limited = enforceRateLimit(request, "upload-token", 30);
      if (limited) return limited;
      if (!hasValidAccessKey(request)) {
        return jsonError("Неверный код доступа.", 401);
      }
    }

    const result = await handleUploadPresigned({
      request,
      body,
      getSignedToken: async (pathname, clientPayload, multipart) => {
        if (!/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/source-video\.(mp4|mov|webm)$/.test(pathname)) {
          throw new Error("Недопустимый путь загрузки.");
        }
        const payload = parsePayload(clientPayload);
        if (!hasValidDeletionSignature(pathname, payload.expiresAt, payload.deleteToken)) {
          throw new Error("Подпись загрузки недействительна.");
        }
        const extension = getExtension(pathname) as keyof typeof SUPPORTED_VIDEO_TYPES;
        const expectedMultipart = multipart;
        const validUntil = Date.now() + 4 * 60 * 60 * 1000;
        const allowedContentTypes = [...SUPPORTED_VIDEO_TYPES[extension]];
        const tokenPayload = JSON.stringify({ ...payload, expectedMultipart });

        return {
          token: await issueSignedToken({
            pathname,
            operations: ["put"],
            allowedContentTypes,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            validUntil,
          }),
          urlOptions: {
            allowedContentTypes,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            validUntil,
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
            tokenPayload,
          },
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const payload = parsePayload(tokenPayload ?? null);
          await start(deleteUploadAtExpiry, [blob.url, payload.expiresAt]);
        } catch (error) {
          console.error("Failed to schedule upload expiry", error);
          throw error;
        }
      },
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Загрузка не разрешена.";
    return jsonError(message, 400);
  }
}
