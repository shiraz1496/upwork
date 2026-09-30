import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, redact, verifyPassword } from "@/lib/crypto";

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips and produces different ciphertext each time", () => {
    const a = encryptSecret("access-token-xyz");
    const b = encryptSecret("access-token-xyz");
    expect(a).not.toBe(b);
    expect(a).not.toContain("access-token-xyz");
    expect(decryptSecret(a)).toBe("access-token-xyz");
  });

  it("rejects tampered ciphertext", () => {
    const [iv, tag, enc] = encryptSecret("secret").split(":");
    const flipped = Buffer.from(enc, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString("base64")}`)).toThrow();
  });
});

describe("passwords + redaction", () => {
  it("hashes and verifies", () => {
    const h = hashPassword("hunter2hunter2");
    expect(verifyPassword("hunter2hunter2", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", null)).toBe(false);
  });

  it("redacts sensitive keys at any depth", () => {
    const out = redact({ accessToken: "a", nested: { refreshToken: "r", coverLetter: "c", ok: 1 } });
    expect(out).toEqual({ accessToken: "[redacted]", nested: { refreshToken: "[redacted]", coverLetter: "[redacted]", ok: 1 } });
  });
});
