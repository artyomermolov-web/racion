import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { registerAction } from "@/app/actions/auth";
import { AuthForm } from "@/app/login/AuthForm";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dnevnik");

  return (
    <div className="app">
      <div className="auth">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            🥗
          </div>
          <h1>Создать аккаунт</h1>
          <p>Пара минут — и рацион под ваши цели</p>
        </div>

        <AuthForm mode="register" action={registerAction} />

        <div className="switch">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </div>
      </div>
    </div>
  );
}
