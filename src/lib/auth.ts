// Серверный клей авторизации: связывает чистое ядро (/core/auth) с Prisma и cookie.
// Тестами детально не покрывается (по конвенции spec.md) — логика вынесена в /core/auth.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiry,
  SESSION_TTL_MS,
} from "@/core/auth/session";

export const SESSION_COOKIE = "racion_session";

/** Создаёт сессию в БД и ставит httpOnly-cookie с сырым токеном. */
export async function createSession(userId: string): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry();

  await prisma.session.create({
    data: { tokenHash: hashSessionToken(token), userId, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Возвращает текущего пользователя по cookie или null. Истёкшие сессии чистит.
 * Обёрнут в React cache(): в рамках одного запроса layout и страница
 * переиспользуют один результат вместо повторного обращения к БД.
 */
export const getCurrentUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
});

/** Требует авторизации: возвращает пользователя или уводит на /login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Удаляет текущую сессию из БД и снимает cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
      .catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
}
