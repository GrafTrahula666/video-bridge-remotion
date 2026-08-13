import { getClientIp } from "@/lib/security";
import { consumeRateLimit } from "@/lib/rate-limit";

export function jsonError(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

export function enforceRateLimit(
  request: Request,
  bucket: string,
  limit = 20,
  windowMs = 10 * 60 * 1000,
): Response | null {
  const result = consumeRateLimit(bucket, getClientIp(request), limit, windowMs);
  if (result.allowed) return null;

  return jsonError("Слишком много запросов. Попробуйте немного позже.", 429, {
    "Retry-After": String(result.retryAfterSeconds),
  });
}
