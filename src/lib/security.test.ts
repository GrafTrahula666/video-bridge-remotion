import { beforeAll, describe, expect, it } from "vitest";
import {
  hasValidAccessKey,
  hasValidCronSecret,
  hasValidDeletionSignature,
  signDeletion,
} from "@/lib/security";

beforeAll(() => {
  process.env.VIDEOBRIDGE_ACCESS_KEY = "test-access-key";
  process.env.VIDEOBRIDGE_SIGNING_SECRET = "test-signing-secret-with-entropy";
  process.env.CRON_SECRET = "test-cron-secret";
});

describe("request security", () => {
  it("uses constant-time compatible access key checks", () => {
    expect(hasValidAccessKey(new Request("https://example.test", { headers: { "x-videobridge-key": "test-access-key" } }))).toBe(true);
    expect(hasValidAccessKey(new Request("https://example.test", { headers: { "x-videobridge-key": "wrong" } }))).toBe(false);
  });

  it("signs deletion ownership", () => {
    const pathname = "uploads/2026-08-13/uuid/source-video.mp4";
    const expiresAt = "2026-08-14T12:00:00.000Z";
    const signature = signDeletion(pathname, expiresAt);
    expect(hasValidDeletionSignature(pathname, expiresAt, signature)).toBe(true);
    expect(hasValidDeletionSignature(`${pathname}-changed`, expiresAt, signature)).toBe(false);
  });

  it("validates the Vercel cron bearer secret", () => {
    expect(hasValidCronSecret(new Request("https://example.test", { headers: { authorization: "Bearer test-cron-secret" } }))).toBe(true);
    expect(hasValidCronSecret(new Request("https://example.test"))).toBe(false);
  });
});
