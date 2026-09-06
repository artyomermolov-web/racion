// Логика серверной сессии (тикет 08): генерация токена, его хеширование для БД,
// срок жизни. Сырой токен уходит в httpOnly-cookie, в БД лежит только SHA-256 хеш.
import { randomBytes, createHash } from "node:crypto";

// 30 дней.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

export function isSessionExpired(
  session: { expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return session.expiresAt.getTime() <= now.getTime();
}
