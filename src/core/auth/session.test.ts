import { describe, it, expect } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiry,
  isSessionExpired,
  SESSION_TTL_MS,
} from "./session";

describe("generateSessionToken", () => {
  it("возвращает непустой hex-токен", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("два вызова дают разные токены", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });
});

describe("hashSessionToken", () => {
  it("детерминирован для одного токена", () => {
    expect(hashSessionToken("abc")).toBe(hashSessionToken("abc"));
  });

  it("разные токены дают разные хеши, и хеш не равен токену", () => {
    expect(hashSessionToken("abc")).not.toBe(hashSessionToken("abd"));
    expect(hashSessionToken("abc")).not.toBe("abc");
  });
});

describe("sessionExpiry", () => {
  it("отстоит от текущего момента на срок жизни сессии", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(sessionExpiry(now).getTime()).toBe(now.getTime() + SESSION_TTL_MS);
  });
});

describe("isSessionExpired", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("не истекла, если срок в будущем", () => {
    const future = new Date(now.getTime() + 1000);
    expect(isSessionExpired({ expiresAt: future }, now)).toBe(false);
  });

  it("истекла, если срок в прошлом", () => {
    const past = new Date(now.getTime() - 1000);
    expect(isSessionExpired({ expiresAt: past }, now)).toBe(true);
  });
});
