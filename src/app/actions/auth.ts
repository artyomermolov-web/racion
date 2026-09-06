"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { hashPassword, verifyPassword, fakeVerify } from "@/core/auth/password";
import {
  normalizeEmail,
  validateRegistration,
  type RegistrationErrors,
} from "@/core/auth/validation";

export interface AuthFormState {
  errors: RegistrationErrors & { form?: string };
  values: { email: string };
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const consent = formData.get("consent") === "on";

  const errors = validateRegistration({ email, password, consent });
  if (Object.keys(errors).length > 0) {
    return { errors, values: { email } };
  }

  const normalized = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    return {
      errors: { email: "Эта почта уже зарегистрирована" },
      values: { email },
    };
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: normalized,
        passwordHash: await hashPassword(password),
        consentAt: new Date(),
      },
    });
  } catch (e) {
    // Гонка check-then-create: уникальный индекс email нарушен (P2002).
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return {
        errors: { email: "Эта почта уже зарегистрирована" },
        values: { email },
      };
    }
    throw e;
  }

  await createSession(user.id);
  redirect("/home");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const values = { email };
  if (email.trim().length === 0 || password.length === 0) {
    return { errors: { form: "Введите почту и пароль" }, values };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  // Даже без пользователя выполняем сравнение bcrypt — выравниваем время ответа.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await fakeVerify(password);
  if (!user || !ok) {
    return { errors: { form: "Неверная почта или пароль" }, values };
  }

  await createSession(user.id);
  redirect("/home");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
