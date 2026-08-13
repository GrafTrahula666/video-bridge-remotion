import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "@/lib/rate-limit";

describe("best-effort rate limiting", () => {
  it("blocks requests after the configured limit", () => {
    const id = crypto.randomUUID();
    expect(consumeRateLimit("test", id, 2, 60_000).allowed).toBe(true);
    expect(consumeRateLimit("test", id, 2, 60_000).allowed).toBe(true);
    const blocked = consumeRateLimit("test", id, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
