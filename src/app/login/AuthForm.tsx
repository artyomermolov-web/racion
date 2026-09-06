"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthFormState } from "@/app/actions/auth";

type Action = (
  prev: AuthFormState,
  formData: FormData,
) => Promise<AuthFormState>;

interface AuthFormProps {
  mode: "login" | "register";
  action: Action;
}

const initialState: AuthFormState = { errors: {}, values: { email: "" } };

export function AuthForm({ mode, action }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const isRegister = mode === "register";

  return (
    <form action={formAction} noValidate>
      {state.errors.form ? (
        <div className="form-error" role="alert">
          {state.errors.form}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="email">Электронная почта</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="input"
          placeholder="you@example.com"
          defaultValue={state.values.email}
          aria-invalid={state.errors.email ? true : undefined}
        />
        {state.errors.email ? (
          <div className="error">{state.errors.email}</div>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="password">Пароль</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          className="input"
          placeholder={isRegister ? "Не короче 8 символов" : "Ваш пароль"}
          aria-invalid={state.errors.password ? true : undefined}
        />
        {state.errors.password ? (
          <div className="error">{state.errors.password}</div>
        ) : null}
      </div>

      {isRegister ? (
        <>
          <label className="consent">
            <input type="checkbox" name="consent" />
            <span>
              Я согласен на обработку персональных данных и принимаю{" "}
              <Link href="/privacy" target="_blank">
                политику конфиденциальности
              </Link>
              .
            </span>
          </label>
          {state.errors.consent ? (
            <div className="error" style={{ marginTop: -8, marginBottom: 12 }}>
              {state.errors.consent}
            </div>
          ) : null}
        </>
      ) : null}

      <button type="submit" className="btn" disabled={pending}>
        {pending
          ? "Подождите…"
          : isRegister
            ? "Зарегистрироваться"
            : "Войти"}
      </button>
    </form>
  );
}
