import { createHmac, timingSafeEqual } from "node:crypto";
import { readServerSecret } from "@/lib/config";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function hasValidAccessKey(request: Request): boolean {
  const supplied = request.headers.get("x-videobridge-key")?.trim() ?? "";
  return safeEqual(supplied, readServerSecret("VIDEOBRIDGE_ACCESS_KEY"));
}

export function signDeletion(pathname: string, expiresAt: string): string {
  return createHmac(
    "sha256",
    readServerSecret("VIDEOBRIDGE_SIGNING_SECRET"),
  )
    .update(`${pathname}\n${expiresAt}`)
    .digest("base64url");
}

export function hasValidDeletionSignature(
  pathname: string,
  expiresAt: string,
  signature: string,
): boolean {
  return safeEqual(signDeletion(pathname, expiresAt), signature);
}

export function hasValidCronSecret(request: Request): boolean {
  const supplied = request.headers.get("authorization") ?? "";
  return safeEqual(
    supplied,
    `Bearer ${readServerSecret("CRON_SECRET")}`,
  );
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
