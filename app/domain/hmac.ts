import { createHmac, timingSafeEqual } from "node:crypto";

export function computeShopifyHmac(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

export function verifyShopifyHmac(
  rawBody: Buffer,
  headerValue: string | null | undefined,
  secret: string,
): boolean {
  if (!headerValue || !secret) return false;
  const computed = computeShopifyHmac(rawBody, secret);
  const a = Buffer.from(computed, "base64");
  let b: Buffer;
  try {
    b = Buffer.from(headerValue, "base64");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
